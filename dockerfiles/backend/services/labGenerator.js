/**
 * Lab Generator
 *
 * Uses Claude's tool-use structured output to convert raw PDF/CSV text
 * into a complete guided lab: title, steps, descriptions, hints,
 * troubleshooting tips, and verify commands.
 *
 * Also provides per-step improvement via a lighter Haiku call.
 *
 * Follows the same patterns as courseAnalyzer.js:
 *   - Lazy SDK loading
 *   - Tool-use for schema-enforced output
 *   - Exponential backoff on retryable errors
 *   - Head+tail truncation for large inputs
 *
 * Env vars:
 *   CLAUDE_API_KEY   - required
 *   CLAUDE_MODEL     - optional, defaults to claude-sonnet-4-6
 */

const { logger } = require('../plugins/logger');

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_INPUT_CHARS = 60000;

// ─── Tool Definition ──────────────────────────────────────────────────────

const LAB_GENERATION_TOOL = {
  name: 'submit_guided_lab',
  description: 'Submit a guided lab. Follow the system prompt for quality requirements.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Action-oriented lab title' },
      slug: { type: 'string', description: 'URL-safe slug (lowercase, hyphens)' },
      description: { type: 'string', description: '2-3 sentence summary' },
      cloud: { type: 'string', enum: ['azure', 'aws', 'gcp', 'container', 'vm'] },
      difficulty: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
      duration: { type: 'number', description: 'Minutes to complete (60-360)' },
      category: { type: 'string', description: 'Compute, Storage, Networking, Security, Databases, AI/ML, DevOps, Containers, or General' },
      tags: { type: 'array', items: { type: 'string' } },
      steps: {
        type: 'array',
        description: 'Ordered lab steps (5-15). Cover every topic. See system prompt for format.',
        items: {
          type: 'object',
          properties: {
            order: { type: 'number' },
            title: { type: 'string', description: 'Action-oriented step title' },
            description: { type: 'string', description: 'Detailed instructions (150-400 words) with Objective, Commands in code blocks, and Expected Output. See system prompt.' },
            hint: { type: 'string', description: 'Contextual guidance (2-3 sentences)' },
            verifyType: { type: 'string', enum: ['manual', 'auto', 'none'] },
            verifyCommand: { type: 'string', description: 'CLI command that exits 0 on success' },
            verifyExpectedOutput: { type: 'string', description: 'Simple regex for verify output' },
            troubleshooting: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  issue: { type: 'string' },
                  solution: { type: 'string' },
                },
                required: ['issue', 'solution'],
              },
            },
          },
          required: ['order', 'title', 'description', 'hint', 'verifyType'],
        },
      },
      labTroubleshooting: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            issue: { type: 'string' },
            solution: { type: 'string' },
            category: { type: 'string' },
          },
          required: ['issue', 'solution', 'category'],
        },
      },
      containerImage: { type: 'string', description: 'Image key from AVAILABLE_IMAGES when cloud=container' },
      containerConfig: {
        type: 'object',
        properties: {
          cpus: { type: 'number', description: 'CPU cores (1-8, default 2)' },
          memory: { type: 'number', description: 'Memory MB (512-16384, default 2048)' },
        },
      },
      vmTemplateName: { type: 'string', description: 'VM template when cloud=azure' },
      cloudRecommendation: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
          alternative: { type: 'string', enum: ['azure', 'aws', 'gcp', 'container', 'vm', 'none'] },
          alternativeReason: { type: 'string' },
        },
        required: ['reason'],
      },
    },
    required: ['title', 'slug', 'description', 'cloud', 'difficulty', 'duration', 'steps', 'cloudRecommendation'],
  },
};

// ─── System Prompts ───────────────────────────────────────────────────────

const GENERATION_SYSTEM_PROMPT = `You are a senior DevOps engineer creating production-grade guided labs for GetLabs — a cloud training platform with real VMs, containers, and cloud sandboxes.

Read the input (PDF/CSV — syllabus, TOC, lab manual, or topics) and generate a COMPLETE guided lab executable start-to-finish on a fresh system.

## CORE RULES
1. STEPS are the primary output — spend 90%+ of tokens on steps.
2. Every command must be CORRECT. No placeholders, no pseudo-code.
3. Complete install sequences: GPG key → repo → apt update → install.
4. Show FULL config files via heredoc (cat << 'EOF' > /path). Never say "edit the file."
5. Cover EVERY module/topic from the input. Do not skip any.
6. Build on previous steps — reference prior resources and configs.
7. Use sudo where needed. Include ports, URLs, credentials.

## STEP FORMAT
Each step description must contain:
**Objective:** 1-2 sentences on what and why.
**Commands:** \`\`\`bash blocks with exact commands and comments.
**Expected Output:** What the student should see (output, URLs, status).

## STEP COUNT
- 1-3 modules → 5-8 steps | 4-7 modules → 8-12 steps | 8+ modules → 10-15 steps
- At least 1 step per module. MAXIMUM 15 steps.
- Sequence: system prep → core install → hands-on tasks per module → integration test → validation

## VERIFICATION (70%+ auto)
- verifyType "auto" with real commands that exit 0 on success:
  systemctl is-active --quiet X | curl -sf URL > /dev/null | test -f PATH | docker ps | grep -q X | ss -tlnp | grep -q :PORT
- verifyExpectedOutput: simple regex ("active", "running", "200")
- "manual" only for GUI checks; "none" for info-only steps

## TROUBLESHOOTING
- Per-step: 1-2 items with exact error messages and fix commands
- Lab-wide: 3-5 items (networking, permissions, disk, service failures)

## INFRASTRUCTURE SELECTION
Choose the best cloud type and fill cloudRecommendation with specific reasoning.

**container** (preferred): CLI-based Linux labs, Docker/K8s, DevOps tools, programming, security, monitoring, ML, web dev, general Linux admin.
**vm**: Labs needing a full VM but NOT specific to any cloud provider. Use for: Oracle DB, Windows Server, Active Directory, GUI desktops, kernel-level ops, systemd as PID 1, heavy workloads (>8GB RAM). Set vmTemplateName: "windows-server-2022" for Windows labs, "ubuntu-22" for Linux, "oracle-linux" for Oracle DB, "rhel-9" for RHEL.
**azure**: Labs specifically about Azure services (Azure portal, Azure CLI, ARM templates, AKS, etc.)
**aws**: AWS services (S3, EC2, Lambda, IAM, CloudFormation, etc.)
**gcp**: GCP services (GKE, BigQuery, Cloud Functions, etc.)

Container image: pick from AVAILABLE_IMAGES in user message. Set containerConfig cpus (2-4) and memory (2048-8192 MB); heavy workloads get cpus=4, memory=4096+.
VM: set vmTemplateName ("ubuntu-22", "windows-server-2022", "oracle-linux", "rhel-9").
AWS/GCP: no image/template needed.

## INPUT HANDLING
- Lab manuals → extract steps, add missing commands, enhance with verification
- Syllabi/TOC → 1-2 hands-on steps per module with real commands
- CSV → each row becomes a step with complete commands
- Sparse inputs → use deep technical knowledge to fill in correct commands

Respond ONLY by calling submit_guided_lab.`;

// ─── Helper: Get Anthropic Client ─────────────────────────────────────────

function getClient() {
  if (!process.env.CLAUDE_API_KEY) {
    throw new Error('CLAUDE_API_KEY env var is not set');
  }
  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch (e) {
    throw new Error('@anthropic-ai/sdk is not installed. Run: npm install @anthropic-ai/sdk');
  }
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY, timeout: 240_000 });
}

// ─── Helper: Truncate Long Text ───────────────────────────────────────────

function truncateText(text, maxChars = MAX_INPUT_CHARS) {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  return text.slice(0, half) + '\n\n[... truncated middle ...]\n\n' + text.slice(-half);
}

// ─── Helper: Retry with Backoff ───────────────────────────────────────────

const API_TIMEOUT_MS = 240_000; // 4 minutes hard timeout per API call

async function callWithRetry(client, params) {
  const MAX_RETRIES = 3;
  let response;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.info(`[labGenerator] API call attempt ${attempt + 1}/${MAX_RETRIES + 1} (model: ${params.model})`);
      // Race the API call against a hard timeout to prevent indefinite hangs
      response = await Promise.race([
        client.messages.create(params),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`API call timed out after ${API_TIMEOUT_MS / 1000}s`)), API_TIMEOUT_MS)
        ),
      ]);
      logger.info(`[labGenerator] API call succeeded (stop_reason: ${response.stop_reason}, tokens: ${response.usage?.output_tokens})`);
      break;
    } catch (err) {
      const isRetryable = err.status === 529 || err.status === 503 || err.status === 500
        || err.message?.includes('Overloaded') || err.message?.includes('timed out');
      if (isRetryable && attempt < MAX_RETRIES) {
        const waitMs = [5000, 15000, 30000][attempt];
        logger.warn(`[labGenerator] Claude API returned ${err.status || 'error'}: ${err.message}, retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      logger.error(`[labGenerator] Claude API call failed after ${attempt + 1} attempts: ${err.message}`);
      throw new Error(`Claude API error: ${err.message}`);
    }
  }
  return response;
}

// ─── Generate Full Lab from PDF or CSV ────────────────────────────────────

async function generateLabFromContent(contentText, { cloudHint, difficultyHint, customPrompt, fileType } = {}) {
  logger.info(`[labGenerator] starting generation (input: ${contentText.length} chars, cloud: ${cloudHint}, difficulty: ${difficultyHint}, type: ${fileType}, customPrompt: ${customPrompt ? customPrompt.length + ' chars' : 'none'})`);
  const client = getClient();
  logger.info('[labGenerator] Anthropic client created');
  const trimmed = truncateText(contentText);

  // Build available container images list for the AI
  let availableImages = '';
  try {
    const { CONTAINER_IMAGES } = require('./containerService');
    availableImages = Object.entries(CONTAINER_IMAGES)
      .map(([key, val]) => `  ${key} — ${val.label}`)
      .join('\n');
  } catch {
    availableImages = '  ubuntu-desktop, kali-desktop, docker-k8s-lab, devops-cicd, terraform-lab, elk-stack, ai-ml-lab, ansible-lab, soc-analyst, monitoring-lab, fullstack-lab, bigdata-workspace, jupyter-scipy, code-server, windows-desktop';
  }

  let hints = '';
  if (cloudHint && cloudHint !== 'auto') {
    hints += `\nCloud provider hint: ${cloudHint.toUpperCase()}. Use this unless the content clearly targets a different provider.`;
  }
  if (difficultyHint && difficultyHint !== 'auto') {
    hints += `\nDifficulty hint: ${difficultyHint}. Use this unless the content clearly suggests otherwise.`;
  }
  if (customPrompt) {
    hints += `\n\nINSTRUCTOR INSTRUCTIONS (follow these closely):\n${customPrompt}`;
  }

  const formatLabel = fileType === 'csv' ? 'CSV' : 'PDF';
  const userMessage = `${hints}

AVAILABLE_IMAGES (use one of these keys for containerImage if cloud=container):
${availableImages}

--- ${formatLabel} CONTENT ---
${trimmed}
--- END ${formatLabel} CONTENT ---

Analyze this ${formatLabel} content and generate an ADVANCED, production-grade guided lab.

Key requirements:
- Cover EVERY module/topic from the document — do not skip any
- Each step must have COMPLETE, CORRECT CLI commands that work on a fresh system
- Include full repository setup (GPG keys, apt sources), package installations, config file contents via heredoc, service management
- Auto-verify (verifyType: "auto") for 70%+ of steps with real CLI commands that exit 0 on success
- For TOC/syllabus: generate 1-2 steps per module to cover the entire curriculum
- Auto-detect the best cloud type and container image / VM template
- Keep step descriptions concise: 100-250 words each with key commands
- Maximum 10 steps — merge related topics into single steps if needed

Call submit_guided_lab now.`;

  const started = Date.now();
  logger.info(`[labGenerator] calling Claude API (model: ${MODEL}, max_tokens: 8192, userMsg: ${userMessage.length} chars)`);

  // First attempt — 8192 tokens keeps response under ~2 min
  let response = await callWithRetry(client, {
    model: MODEL,
    max_tokens: 8192,
    system: GENERATION_SYSTEM_PROMPT,
    tools: [LAB_GENERATION_TOOL],
    tool_choice: { type: 'tool', name: 'submit_guided_lab' },
    messages: [{ role: 'user', content: userMessage }],
  });

  let toolUse = (response.content || []).find(c => c.type === 'tool_use');
  const wasTruncated = response.stop_reason === 'max_tokens';
  const hasNoSteps = !toolUse?.input?.steps || toolUse.input.steps.length === 0;

  // If truncated or no steps, retry with focused instructions (still advanced quality)
  if (wasTruncated || hasNoSteps) {
    const usage1 = response.usage || {};
    logger.warn(`[labGenerator] First attempt truncated or missing steps (stop_reason=${response.stop_reason}, steps=${toolUse?.input?.steps?.length || 0}, out:${usage1.output_tokens}). Retrying...`);

    const retryMessage = `${hints}

AVAILABLE_IMAGES (use one of these keys for containerImage if cloud=container):
${availableImages}

--- ${formatLabel} CONTENT ---
${trimmed}
--- END ${formatLabel} CONTENT ---

IMPORTANT: Your previous attempt ran out of output tokens.
Generate a COMPLETE lab with these constraints to fit within the token budget:
- Maximum 10 steps (merge related topics into single steps)
- Step descriptions: 100-200 words each (include key commands but keep concise)
- 1 troubleshooting item per step max
- labTroubleshooting: 3 items
- verifyType: "auto" for 70%+ of steps
You MUST complete ALL steps. Call submit_guided_lab now.`;

    response = await callWithRetry(client, {
      model: MODEL,
      max_tokens: 8192,
      system: GENERATION_SYSTEM_PROMPT,
      tools: [LAB_GENERATION_TOOL],
      tool_choice: { type: 'tool', name: 'submit_guided_lab' },
      messages: [{ role: 'user', content: retryMessage }],
    });

    toolUse = (response.content || []).find(c => c.type === 'tool_use');

    if (response.stop_reason === 'max_tokens') {
      logger.warn('[labGenerator] Retry also truncated — returning partial result');
    }
  }

  if (!toolUse || !toolUse.input) {
    logger.error('[labGenerator] Claude did not return a tool_use block', { content: response.content });
    throw new Error('Claude did not return a structured lab');
  }

  if (!toolUse.input.steps || toolUse.input.steps.length === 0) {
    logger.error('[labGenerator] Generated lab has no steps even after retry');
    throw new Error('AI generated lab metadata but no steps. The document may be too large or complex — try a shorter input.');
  }

  const elapsed = Date.now() - started;
  const usage = response.usage || {};
  logger.info(`[labGenerator] lab generated in ${elapsed}ms (in:${usage.input_tokens} out:${usage.output_tokens} tokens, steps:${toolUse.input.steps.length})`);

  return {
    lab: toolUse.input,
    meta: {
      model: MODEL,
      elapsedMs: elapsed,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
    },
  };
}

// ─── Improve Single Step Field ────────────────────────────────────────────

const IMPROVE_PROMPTS = {
  description: `You are a senior DevOps engineer writing production-grade lab instructions. Rewrite this step description to be COMPLETE and EXECUTABLE on a fresh system.

Requirements:
1. Start with "**Objective:** " — 1-2 sentences on what this step does and why
2. Show EVERY command in \`\`\`bash code blocks with comments
3. Include: repository setup (GPG keys, apt sources), package installation, config file creation with FULL heredoc contents, service enable/start, permission changes, firewall rules
4. NEVER say "edit the file" — show the exact file content with cat << 'EOF' > /path
5. NEVER skip dependencies — show every install command
6. End with "**Expected Output:** " — what the student sees (service status, URLs, file paths)
7. Target 200-400 words
8. Use sudo where appropriate

Return ONLY the improved description text.`,
  hint: `You are a senior training instructor. Write a helpful hint that:
1. Points the student toward the right tool, command, or config file path
2. Mentions a specific flag, option, or config key they might need
3. Does NOT give the full answer — just enough to unblock them
4. Is 2-3 sentences, specific to the technology (not generic advice)

Return ONLY the hint text.`,
  troubleshooting: `You are a senior DevOps engineer. Generate 3 common troubleshooting items for this lab step.

For each item:
- "issue": The EXACT error message or symptom a student would see (e.g., "E: Unable to locate package jenkins" or "curl: (7) Failed to connect to localhost port 8080: Connection refused")
- "solution": Step-by-step fix with EXACT commands to run (not just an explanation)

Return a JSON array of objects with "issue" and "solution" fields. Return ONLY the JSON array, no explanation or markdown fences.`,
  verifyCommand: `You are a DevOps engineer. Write a CLI command that verifies this step was completed successfully.

Requirements:
- Must return exit code 0 on success, non-zero on failure
- Must work on a standard Linux system (Ubuntu/Debian)
- Use specific checks: systemctl is-active --quiet, test -f, curl -sf, docker ps | grep -q, pgrep -f, ss -tlnp | grep -q
- Combine multiple checks with && for thorough verification
- Do NOT use interactive commands

Return ONLY the command, no explanation.`,
  verifyExpectedOutput: `You are a DevOps engineer. Write a regex pattern that matches the expected stdout of the verify command for this step.

Requirements:
- Keep it simple — match 1-2 key words
- Use basic regex: no lookaheads, no complex groups
- Examples: "active", "running", "200", "nginx", "Jenkins"

Return ONLY the regex pattern, no explanation.`,
};

async function improveStep(step, field, labContext = {}) {
  const client = getClient();

  const systemPrompt = IMPROVE_PROMPTS[field];
  if (!systemPrompt) {
    throw new Error(`Unknown field to improve: ${field}`);
  }

  const contextLines = [];
  if (labContext.title) contextLines.push(`Lab: ${labContext.title}`);
  if (labContext.cloud) contextLines.push(`Cloud: ${labContext.cloud}`);
  if (labContext.difficulty) contextLines.push(`Difficulty: ${labContext.difficulty}`);

  const userMessage = `${contextLines.length > 0 ? contextLines.join(' | ') + '\n\n' : ''}Step ${step.order || '?'}: ${step.title}
Current description: ${step.description || '(empty)'}
Current hint: ${step.hint || '(none)'}
Current verify command: ${step.verifyCommand || '(none)'}
Verify type: ${step.verifyType || 'manual'}

Improve the "${field}" for this step.`;

  const started = Date.now();
  const response = await callWithRetry(client, {
    model: HAIKU_MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = (response.content || [])
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('');

  const elapsed = Date.now() - started;
  const usage = response.usage || {};
  logger.info(`[labGenerator] step improved (${field}) in ${elapsed}ms (in:${usage.input_tokens} out:${usage.output_tokens})`);

  // For troubleshooting, parse the JSON array
  if (field === 'troubleshooting') {
    try {
      const cleaned = text.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) return { improved: parsed, meta: { model: HAIKU_MODEL, elapsedMs: elapsed } };
    } catch (e) {
      logger.warn('[labGenerator] Failed to parse troubleshooting JSON, returning raw text');
    }
  }

  return {
    improved: text.trim(),
    meta: {
      model: HAIKU_MODEL,
      elapsedMs: elapsed,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
    },
  };
}

// ─── Import Steps from Existing Content (Direct Extract) ─────────────

const IMPORT_SYSTEM_PROMPT = `You are a lab step extractor. Given a document containing lab steps/instructions, extract them faithfully into a structured guided lab.

RULES:
1. Extract steps EXACTLY as written — do NOT rewrite, rephrase, or add content that isn't there.
2. Preserve all commands, code blocks, file paths, and config snippets verbatim.
3. Each step should map to one logical task/section from the document.
4. If the document has numbered steps, keep the same structure.
5. If the document is more free-form, break it into logical steps (one per major section).
6. Fill in metadata (title, description, cloud, difficulty, tags) based on the content.
7. For verifyType: set "manual" for all steps unless the document explicitly includes verification commands.
8. For cloud: choose the best infrastructure type based on content. Use "container" for Linux/Docker labs, "vm" for labs needing a full VM, "azure"/"aws"/"gcp" for cloud-specific.

Respond ONLY by calling submit_guided_lab.`;

async function importStepsFromContent(contentText, { cloudHint, difficultyHint, fileType } = {}) {
  logger.info(`[labGenerator] starting import (input: ${contentText.length} chars, type: ${fileType})`);

  // For CSV with step-like columns, try direct parsing first
  if (fileType === 'csv') {
    try {
      const parsed = parseCSVSteps(contentText);
      if (parsed) {
        logger.info(`[labGenerator] CSV parsed directly: ${parsed.steps.length} steps`);
        return { lab: parsed, meta: { model: 'csv-direct', elapsedMs: 0, inputTokens: 0, outputTokens: 0 } };
      }
    } catch (e) {
      logger.warn(`[labGenerator] CSV direct parse failed, falling back to AI: ${e.message}`);
    }
  }

  // AI extraction using Haiku (fast + cheap) — just structure, no rewriting
  const client = getClient();
  const trimmed = truncateText(contentText);

  let hints = '';
  if (cloudHint && cloudHint !== 'auto') hints += `\nCloud hint: ${cloudHint}.`;
  if (difficultyHint && difficultyHint !== 'auto') hints += `\nDifficulty hint: ${difficultyHint}.`;

  const userMessage = `${hints}

--- DOCUMENT CONTENT ---
${trimmed}
--- END DOCUMENT ---

Extract the lab steps from this document. Preserve all commands and instructions EXACTLY as written.
Call submit_guided_lab now.`;

  const started = Date.now();
  logger.info(`[labGenerator] calling Haiku for step import (${userMessage.length} chars)`);

  const response = await callWithRetry(client, {
    model: HAIKU_MODEL,
    max_tokens: 8192,
    system: IMPORT_SYSTEM_PROMPT,
    tools: [LAB_GENERATION_TOOL],
    tool_choice: { type: 'tool', name: 'submit_guided_lab' },
    messages: [{ role: 'user', content: userMessage }],
  });

  const toolUse = (response.content || []).find(c => c.type === 'tool_use');
  if (!toolUse || !toolUse.input) {
    throw new Error('Failed to extract steps from document');
  }
  if (!toolUse.input.steps || toolUse.input.steps.length === 0) {
    throw new Error('No steps could be extracted from the document. Ensure it contains lab instructions.');
  }

  const elapsed = Date.now() - started;
  const usage = response.usage || {};
  logger.info(`[labGenerator] steps imported in ${elapsed}ms (in:${usage.input_tokens} out:${usage.output_tokens}, steps:${toolUse.input.steps.length})`);

  return {
    lab: toolUse.input,
    meta: { model: HAIKU_MODEL, elapsedMs: elapsed, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens },
  };
}

// ─── CSV Direct Parser ────────────────────────────────────────────────

function parseCSVSteps(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return null;

  // Parse header
  const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
  const titleIdx = header.findIndex(h => h === 'title' || h === 'step_title' || h === 'step title');
  const descIdx = header.findIndex(h => h === 'description' || h === 'instructions' || h === 'content' || h === 'step_description');

  if (titleIdx === -1 || descIdx === -1) return null; // Not a step-format CSV

  const hintIdx = header.findIndex(h => h === 'hint' || h === 'hints');
  const verifyIdx = header.findIndex(h => h === 'verify' || h === 'verify_command' || h === 'verifycommand');
  const verifyTypeIdx = header.findIndex(h => h === 'verify_type' || h === 'verifytype');

  const steps = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (!cols[titleIdx] || !cols[descIdx]) continue;
    steps.push({
      order: steps.length + 1,
      title: cols[titleIdx].trim(),
      description: cols[descIdx].trim(),
      hint: hintIdx >= 0 ? (cols[hintIdx] || '').trim() : '',
      verifyType: verifyTypeIdx >= 0 ? (cols[verifyTypeIdx] || 'manual').trim() : 'manual',
      verifyCommand: verifyIdx >= 0 ? (cols[verifyIdx] || '').trim() : '',
      troubleshooting: [],
    });
  }

  if (steps.length === 0) return null;

  return {
    title: 'Imported Lab',
    slug: 'imported-lab-' + Date.now(),
    description: `Lab with ${steps.length} imported steps.`,
    cloud: 'container',
    difficulty: 'intermediate',
    duration: steps.length * 15,
    category: 'General',
    tags: ['imported'],
    steps,
    labTroubleshooting: [],
    cloudRecommendation: { reason: 'Imported from CSV — adjust cloud type as needed.' },
  };
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { result.push(current); current = ''; continue; }
    current += ch;
  }
  result.push(current);
  return result;
}

module.exports = { generateLabFromContent, improveStep, importStepsFromContent };
