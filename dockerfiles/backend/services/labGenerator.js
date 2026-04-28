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
 *   CLAUDE_MODEL     - optional, defaults to claude-sonnet-4-5
 */

const { logger } = require('../plugins/logger');

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_INPUT_CHARS = 60000;

// ─── Tool Definition ──────────────────────────────────────────────────────

const LAB_GENERATION_TOOL = {
  name: 'submit_guided_lab',
  description: 'Submit a structured guided lab generated from PDF or CSV content.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Lab title — action-oriented and concise' },
      slug: { type: 'string', description: 'URL-safe slug (lowercase, hyphens, e.g. "deploy-azure-vm")' },
      description: { type: 'string', description: '2 sentence summary of what students learn and build' },
      cloud: { type: 'string', enum: ['azure', 'aws', 'gcp', 'container'], description: 'Primary cloud provider' },
      difficulty: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
      duration: { type: 'number', description: 'Estimated total minutes to complete the lab' },
      category: { type: 'string', description: 'Category: Compute, Storage, Networking, Security, Databases, AI/ML, DevOps, Containers, or General' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Relevant tags (3-8 tags)' },
      steps: {
        type: 'array',
        description: 'Complete ordered lab steps (5-12 steps). EVERY step must include exact CLI commands.',
        items: {
          type: 'object',
          properties: {
            order: { type: 'number', description: 'Step number starting from 1' },
            title: { type: 'string', description: 'Clear step title (e.g. "Install Docker and Docker Compose")' },
            description: {
              type: 'string',
              description: 'Complete step instructions (100-250 words). Structure: (1) What and why — 1-2 sentences, (2) Exact CLI commands in markdown code blocks with language tags, (3) Expected result — what the student should see. Include ALL commands: installs, config changes, service restarts, file edits. Do NOT skip commands.',
            },
            hint: { type: 'string', description: 'Helpful guidance if the student gets stuck (1-2 sentences, without giving the full answer)' },
            verifyType: { type: 'string', enum: ['manual', 'auto', 'none'], description: 'auto = CLI command verifies success, manual = student visually checks, none = informational' },
            verifyCommand: { type: 'string', description: 'A real CLI command that returns exit code 0 on success. Only if verifyType=auto.' },
            verifyExpectedOutput: { type: 'string', description: 'Regex pattern to match verify command output. Only if verifyType=auto.' },
            troubleshooting: {
              type: 'array',
              description: '0-1 common issues for this step (only where students typically get stuck)',
              items: {
                type: 'object',
                properties: {
                  issue: { type: 'string', description: 'The problem (e.g. "Permission denied when running docker command")' },
                  solution: { type: 'string', description: 'The fix (e.g. "Add your user to the docker group: sudo usermod -aG docker $USER, then log out and back in")' },
                },
                required: ['issue', 'solution'],
              },
            },
          },
          required: ['order', 'title', 'description', 'verifyType'],
        },
      },
      labTroubleshooting: {
        type: 'array',
        description: '2-3 common lab-wide troubleshooting items',
        items: {
          type: 'object',
          properties: {
            issue: { type: 'string' },
            solution: { type: 'string' },
            category: { type: 'string', description: 'Connectivity, Permissions, Environment, Software, or General' },
          },
          required: ['issue', 'solution'],
        },
      },
      containerImage: {
        type: 'string',
        description: 'Container image key from AVAILABLE_IMAGES list. Required when cloud=container. Pick the best match for the lab content.',
      },
      containerConfig: {
        type: 'object',
        description: 'Container resource config. Only when cloud=container.',
        properties: {
          cpus: { type: 'number', description: 'CPU cores (1-8). Default 2.' },
          memory: { type: 'number', description: 'Memory in MB (512-16384). Default 2048.' },
        },
      },
      vmTemplateName: {
        type: 'string',
        description: 'Azure VM template/OS name when cloud=azure. e.g. "ubuntu-22", "windows-server-2022", "rhel-9"',
      },
      cloudRecommendation: {
        type: 'object',
        description: 'Explain WHY you chose this infrastructure and what alternative could work.',
        properties: {
          reason: { type: 'string', description: 'Why the chosen cloud/infrastructure is the best fit (1-2 sentences)' },
          alternative: { type: 'string', enum: ['azure', 'aws', 'gcp', 'container', 'none'], description: 'An alternative infrastructure that could also work, or "none"' },
          alternativeReason: { type: 'string', description: 'When the alternative would be a better choice (1 sentence). Empty if alternative is "none".' },
        },
        required: ['reason'],
      },
    },
    required: ['title', 'slug', 'description', 'cloud', 'difficulty', 'duration', 'steps', 'cloudRecommendation'],
  },
};

// ─── System Prompts ───────────────────────────────────────────────────────

const GENERATION_SYSTEM_PROMPT = `You generate production-quality guided labs for GetLabs, a cloud training platform where students work in real VMs, containers, and cloud sandboxes.

Read the input content (PDF/CSV — syllabus, TOC, lab manual, or topics list) and generate a COMPLETE guided lab that a student can follow start-to-finish without any external documentation.

## CRITICAL RULES
1. STEPS ARE THE PRIMARY OUTPUT. Spend most of your output on steps. Keep metadata minimal.
2. Generate 5-12 steps covering the ENTIRE lab from setup to verification/cleanup.
3. Every step MUST include the exact CLI commands, configuration, or actions the student needs.
4. If something needs to be installed, show the install command. If a config file needs editing, show the content.

## Lab Metadata (keep brief)
- title: Action-oriented (e.g. "Deploy a Multi-Container Application with Docker Compose")
- slug: lowercase-hyphens
- description: 2 sentences max — what students will learn and build
- cloud: Detect from content (azure/aws/gcp/container). Default "container" if unclear
- difficulty: beginner/intermediate/advanced
- duration: Realistic minutes (30-240)
- category: Compute|Storage|Networking|Security|Databases|AI/ML|DevOps|Containers|General
- tags: 3-5 keywords

## Step Format (THIS IS THE MOST IMPORTANT PART)
Each step must have this structure in the description field:

1. **What & Why** — 1-2 sentences explaining the goal of this step
2. **Commands** — Every command the student must run, in \`code blocks\`. Include:
   - Package installs (apt-get, yum, pip, npm, etc.)
   - File creation/editing (show file contents when needed)
   - Service commands (systemctl, docker, kubectl, az, aws, gcloud)
   - Configuration commands
3. **Expected Result** — 1 sentence on what the student should see after running the commands

Step descriptions should be 100-250 words each. Commands are critical — do not skip them.

## Step Guidelines
- Step 1: Environment setup (verify prerequisites, install tools, login to cloud)
- Middle steps: Core lab tasks with complete commands
- Final step: Verification that everything works, then cleanup commands
- verifyType: Use "auto" when a CLI command can check success, "manual" for visual checks, "none" for info-only steps
- verifyCommand: Must be a real command that returns exit 0 on success (e.g. \`docker ps | grep myapp\`, \`az vm show --name myvm -g myrg --query provisioningState -o tsv\`)
- hints: 1-2 sentences that guide without giving the answer
- troubleshooting per step: 0-1 items (only for steps where students commonly get stuck)

## Lab-Level Troubleshooting
- 2-3 items covering the most common issues across the entire lab (connectivity, permissions, environment)

## Infrastructure Auto-Detection (IMPORTANT)
Analyze the lab content and choose the BEST infrastructure. You MUST also fill cloudRecommendation with your reasoning.

### Decision Framework — Container vs Azure VM vs Cloud Sandbox

**USE container WHEN (preferred — faster startup, lower cost):**
- CLI/terminal-based Linux labs (bash, networking, scripting)
- Docker, Kubernetes, container orchestration
- DevOps tools (Jenkins, GitLab CI, ArgoCD, Ansible, Terraform)
- Programming/coding labs (Python, Node.js, Go, Java, etc.)
- Security/pentesting (Kali, Wazuh, Suricata)
- Monitoring (Prometheus, Grafana, ELK)
- Data science / ML (Jupyter, TensorFlow, PyTorch)
- Web development (full-stack, APIs)
- General Linux administration
- Any lab where commands run in a terminal and don't need a full OS kernel

**USE azure WHEN (full VM required):**
- Windows Server labs (Active Directory, Group Policy, DHCP, DNS, IIS)
- Labs requiring GUI desktop interaction (Windows Explorer, Server Manager, MMC snap-ins)
- Kernel-level operations (custom kernel modules, iptables at kernel level, systemd-nspawn)
- Multi-NIC networking, custom VLAN, or bridge configurations
- Labs that need systemd as PID 1 (containers use init alternatives)
- GPU workloads requiring direct hardware access
- Labs needing >8GB RAM or >4 CPUs
- Content explicitly mentions Azure portal, Azure CLI, or Azure-specific services (AKS, Azure Functions, Azure DevOps)
- OS-level labs: Windows/Linux installation, boot configuration, disk partitioning

**USE aws WHEN:** Content requires AWS services (S3, EC2, Lambda, IAM, CloudFormation, etc.)
**USE gcp WHEN:** Content requires GCP services (Compute Engine, GKE, BigQuery, Cloud Functions, etc.)

### cloudRecommendation (REQUIRED)
Always explain your choice:
- reason: Why this infrastructure is the best fit
- alternative: Could another option work? ("container", "azure", "aws", "gcp", or "none")
- alternativeReason: When would the alternative be better? (e.g. "Use Azure VM if you need full systemd or GUI desktop access")

### cloud = "container" — Image Selection
Set containerImage to the best match from AVAILABLE_IMAGES (provided in the user message).
Selection guide:
- Cybersecurity/penetration testing/ethical hacking → "kali-desktop"
- Docker/Kubernetes/container orchestration → "docker-k8s-lab"
- DevOps/CI-CD/Jenkins/GitLab/ArgoCD → "devops-cicd"
- Terraform/IaC/infrastructure as code → "terraform-lab"
- ELK/Elasticsearch/Logstash/Kibana/SIEM → "elk-stack"
- AI/ML/TensorFlow/PyTorch/deep learning → "ai-ml-lab"
- Ansible/configuration management/RHCE → "ansible-lab"
- SOC/security operations/Wazuh/Suricata → "soc-analyst"
- Monitoring/Prometheus/Grafana → "monitoring-lab"
- Full-stack web dev/Node.js/React/Angular → "fullstack-lab"
- Big data/Kafka/Spark/Hadoop → "bigdata-workspace"
- Python/data science/Jupyter → "jupyter-scipy"
- General Linux admin/Ubuntu → "ubuntu-desktop"
- RHEL/CentOS admin → "redhat-desktop" or "centos-desktop"
- Windows admin/Active Directory/PowerShell → "windows-desktop"
- Programming/coding/VS Code → "code-server"
- COBOL/mainframe → "mainframe-cobol"
- General purpose / unclear → "ubuntu-desktop"

Set containerConfig: cpus (1-4, default 2), memory (1024-8192 MB, default 2048). Heavy workloads (big data, AI/ML, ELK): cpus=4, memory=4096-8192.

### cloud = "azure" — VM Template Selection
Set vmTemplateName to the OS needed: "ubuntu-22", "windows-server-2022", "rhel-9", etc.

### cloud = "aws" / "gcp" — Cloud Sandbox
No containerImage or vmTemplateName needed — sandboxes provisioned separately.

## Input Handling
- Lab manuals → Extract and structure existing steps, add missing commands, enhance with troubleshooting
- Syllabi/TOC → Infer practical hands-on exercises from each topic, create realistic commands
- CSV → Interpret rows as topics/modules, expand each into actionable steps
- Always produce at least 5 steps

Respond ONLY by calling submit_guided_lab. Do not output any prose outside the tool call.`;

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
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
}

// ─── Helper: Truncate Long Text ───────────────────────────────────────────

function truncateText(text, maxChars = MAX_INPUT_CHARS) {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  return text.slice(0, half) + '\n\n[... truncated middle ...]\n\n' + text.slice(-half);
}

// ─── Helper: Retry with Backoff ───────────────────────────────────────────

async function callWithRetry(client, params) {
  const MAX_RETRIES = 3;
  let response;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await client.messages.create(params);
      break;
    } catch (err) {
      const isRetryable = err.status === 529 || err.status === 503 || err.status === 500 || err.message?.includes('Overloaded');
      if (isRetryable && attempt < MAX_RETRIES) {
        const waitMs = [5000, 15000, 30000][attempt];
        logger.warn(`[labGenerator] Claude API returned ${err.status || 'error'}, retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
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

async function generateLabFromContent(contentText, { cloudHint, difficultyHint, fileType } = {}) {
  const client = getClient();
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

  const formatLabel = fileType === 'csv' ? 'CSV' : 'PDF';
  const userMessage = `${hints}

AVAILABLE_IMAGES (use one of these keys for containerImage if cloud=container):
${availableImages}

--- ${formatLabel} CONTENT ---
${trimmed}
--- END ${formatLabel} CONTENT ---

Analyze this ${formatLabel} content and generate a complete guided lab. Auto-detect the best cloud type and container image / VM template. Call submit_guided_lab now.`;

  const started = Date.now();

  // First attempt
  let response = await callWithRetry(client, {
    model: MODEL,
    max_tokens: 16384,
    system: GENERATION_SYSTEM_PROMPT,
    tools: [LAB_GENERATION_TOOL],
    tool_choice: { type: 'tool', name: 'submit_guided_lab' },
    messages: [{ role: 'user', content: userMessage }],
  });

  let toolUse = (response.content || []).find(c => c.type === 'tool_use');
  const wasTruncated = response.stop_reason === 'max_tokens';
  const hasNoSteps = !toolUse?.input?.steps || toolUse.input.steps.length === 0;

  // If truncated or no steps, retry with a stricter budget instruction
  if (wasTruncated || hasNoSteps) {
    const usage1 = response.usage || {};
    logger.warn(`[labGenerator] First attempt truncated or missing steps (stop_reason=${response.stop_reason}, steps=${toolUse?.input?.steps?.length || 0}, out:${usage1.output_tokens}). Retrying with stricter budget...`);

    const retryMessage = `${hints}

--- ${formatLabel} CONTENT ---
${trimmed}
--- END ${formatLabel} CONTENT ---

IMPORTANT: Your previous attempt was truncated — you ran out of output tokens before completing the steps array.
Generate a COMPLETE lab with these STRICT constraints:
- Maximum 8 steps (fewer is fine if the lab doesn't need more)
- Step descriptions: 80-150 words each (include commands but keep explanations brief)
- Skip per-step troubleshooting entirely
- labTroubleshooting: 2 items only
- description: 1-2 sentences only
- tags: 3 max
You MUST complete all steps. The steps array is the most important part — do not run out of tokens before finishing it.
Call submit_guided_lab now.`;

    response = await callWithRetry(client, {
      model: MODEL,
      max_tokens: 16384,
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
  description: `You are a technical writer for cloud training labs. Improve the step description below to be clearer, more detailed, and better formatted with markdown. Include specific CLI commands in code blocks, numbered sub-steps, and expected outcomes. Return ONLY the improved description text, no explanation.`,
  hint: `You are a training lab assistant. Write a better hint for this step — it should gently guide the student without giving away the answer. Return ONLY the hint text, no explanation.`,
  troubleshooting: `You are a cloud infrastructure expert. Generate 3 common troubleshooting items for this lab step. Return a JSON array of objects with "issue" and "solution" fields. Return ONLY the JSON array, no explanation or markdown fences.`,
  verifyCommand: `You are a DevOps engineer. Write a CLI command (bash for Linux, PowerShell for Windows) that verifies this step was completed successfully. The command should return exit code 0 on success. Return ONLY the command, no explanation.`,
  verifyExpectedOutput: `You are a DevOps engineer. Write a regex pattern that matches the expected output of the verify command for this step. Return ONLY the regex pattern, no explanation.`,
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

module.exports = { generateLabFromContent, improveStep };
