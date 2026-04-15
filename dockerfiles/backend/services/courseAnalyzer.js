/**
 * Course Analyzer
 *
 * Uses Claude's tool-use structured output to convert raw course PDF text
 * into a strict JSON analysis: detected provider, modules, hours, services,
 * difficulty, special requirements.
 *
 * Why tool use instead of "please return JSON": Claude's tool-use mode is
 * schema-enforced by the API itself — invalid JSON or missing required
 * fields are rejected by the model, not us.
 *
 * Env vars:
 *   CLAUDE_API_KEY   - required
 *   CLAUDE_MODEL     - optional, defaults to claude-sonnet-4-5
 *                      (Sonnet is the right price/quality for this job;
 *                       override to Opus only if quality is insufficient)
 */

const { logger } = require('../plugins/logger');

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
const MAX_INPUT_CHARS = 60000;   // ~15k tokens of course text, leaves room for output

const ANALYSIS_TOOL = {
  name: 'submit_course_analysis',
  description: 'Submit the structured analysis of a cloud training course PDF.',
  input_schema: {
    type: 'object',
    properties: {
      detectedProvider: {
        type: 'string',
        enum: ['aws', 'azure', 'gcp', 'multi'],
        description: 'Primary cloud provider the course targets. Use "multi" only if the course genuinely spans multiple clouds.',
      },
      courseName: {
        type: 'string',
        description: 'Course title as printed on the PDF (or inferred from headings).',
      },
      description: {
        type: 'string',
        description: 'One-paragraph summary of what the course covers.',
      },
      difficulty: {
        type: 'string',
        enum: ['beginner', 'intermediate', 'advanced'],
      },
      totalHours: {
        type: 'number',
        description: 'Total hands-on lab hours (sum of all module hours). Do NOT include reading/theory time.',
      },
      modules: {
        type: 'array',
        description: 'Every module or chapter in the course that involves hands-on cloud work.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            hours: {
              type: 'number',
              description: 'Hands-on lab hours the student will actually run cloud resources for this module. Conservative estimate.',
            },
            services: {
              type: 'array',
              description: 'Cloud services this module uses. Use lowercase short names: ec2, s3, lambda, aks, bigquery, iam, vpc, etc. Match provider-specific naming.',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  usage: {
                    type: 'string',
                    description: 'Brief note on how the service is used in this module.',
                  },
                },
                required: ['name'],
              },
            },
            notes: { type: 'string' },
          },
          required: ['name', 'hours', 'services'],
        },
      },
      specialRequirements: {
        type: 'array',
        description: 'Flags for unusual needs: "GPU", "multi-region", "bare-metal", "dedicated-host", "cross-account", "hybrid-networking", etc. Empty array if none.',
        items: { type: 'string' },
      },
      recommendedDeployment: {
        type: 'string',
        enum: ['cloud_sandbox', 'container_lab'],
        description: 'How GetLabs should deliver this course. "cloud_sandbox" = real AWS/Azure/GCP accounts (for cert prep, cloud-services courses). "container_lab" = a Linux container preloaded with software (when the PDF asks for a VM with specific tools like Kafka/Spark/Hadoop/MEAN-stack/custom binaries, NOT cloud-service exposure).',
      },
      containerLab: {
        type: 'object',
        description: 'Populate ONLY when recommendedDeployment is container_lab. Otherwise omit entirely.',
        properties: {
          requestedVmSpec: {
            type: 'object',
            description: 'Verbatim VM specs as listed in the PDF.',
            properties: {
              vcpu: { type: 'string' },
              ramGb: { type: 'string' },
              storageGb: { type: 'string' },
              os: { type: 'string' },
              software: {
                type: 'array',
                items: { type: 'string' },
                description: 'Software/binaries the customer asked to be pre-installed: Kafka, Spark, JDK, Python, MySQL, Cassandra, etc.',
              },
            },
          },
          recommendedImageKey: {
            type: 'string',
            description: 'GetLabs catalog key for the matching container image. Use "bigdata-workspace" for Kafka/Spark/MySQL stacks, "bigdata-workspace-cassandra" if Cassandra is required, "ubuntu-xfce" for general Ubuntu desktop, "kali-desktop" for security/pentesting, "vscode-kasm" for dev-only courses, "jupyter-scipy" for data-science notebooks. Pick the closest match.',
          },
          proposedStack: {
            type: 'array',
            description: 'The components GetLabs will provide pre-installed, mapped to customer needs.',
            items: {
              type: 'object',
              properties: {
                component: { type: 'string' },     // e.g. "Apache Kafka 3.7"
                purpose: { type: 'string' },       // e.g. "message broker for streaming labs"
                preInstalled: { type: 'boolean' }, // true if image already has it
              },
              required: ['component', 'purpose'],
            },
          },
          resourcesPerSeat: {
            type: 'object',
            description: 'Conservative per-seat resource budget for a containerized deployment.',
            properties: {
              vcpu: { type: 'number' },
              memoryGb: { type: 'number' },
              storageGb: { type: 'number' },
            },
          },
          estimatedSavingsVsVmPercent: {
            type: 'number',
            description: 'Rough percentage cost savings vs the requested VM spec. Typically 40-70% for containerized labs.',
          },
          notes: {
            type: 'string',
            description: 'Free-text observations: caveats, limitations, or things ops should double-check.',
          },
        },
      },
    },
    required: ['courseName', 'recommendedDeployment'],
  },
};

const SYSTEM_PROMPT = `You are the course analysis engine for GetLabs, a training lab provider that delivers TWO kinds of labs:

1. **Cloud sandbox labs**: real AWS/Azure/GCP accounts for cert-prep and cloud-services courses (AWS Solutions Architect, Azure Administrator, GCP Data Engineer, etc.).
2. **Container labs**: Linux containers preloaded with software stacks for courses that ask for "a VM with Kafka/Spark/Hadoop/MEAN/etc. installed" — these should NEVER be deployed as cloud accounts because the customer doesn't actually need cloud services, just a Linux machine with tools.

Your job: read the provided course PDF, classify it into one of those two paths, and extract the structured analysis.

## Classification rules — read carefully

Set \`recommendedDeployment = "container_lab"\` when ANY of these are true:
- The PDF explicitly lists "VM Specifications" or "Server Requirements" with vCPU/RAM/storage numbers and a list of software (Kafka, Spark, Hadoop, MySQL, Cassandra, JDK, Python, Node, MongoDB, Elasticsearch, Docker, Kubernetes, Jenkins, etc.) to be pre-installed.
- The course is about a specific software stack (Big Data Engineering with Kafka+Spark, MEAN/MERN stack, ELK stack, Docker/K8s fundamentals) rather than cloud-provider services.
- The course title mentions "Linux", "Ubuntu", "RHEL", "CentOS" without naming a cloud provider.
- The customer needs SSH access to a Linux box, not access to cloud APIs.

Set \`recommendedDeployment = "cloud_sandbox"\` when:
- The course is cert-prep for AWS/Azure/GCP exams (CLF-C02, SAA-C03, AZ-104, AZ-900, GCP ACE, etc.).
- The course teaches cloud services by name (S3, EC2, Lambda, Azure VM, BigQuery, etc.).
- The customer needs to log into the AWS/Azure/GCP console and click around.
- The course title mentions "AWS", "Azure", "GCP", "Cloud" prominently.

When in doubt, lean toward container_lab if the course mentions specific software packages that need to be installed. Cloud sandboxes can't pre-install software — that's a container's job.

## Output rules

For BOTH paths you MUST fill in: courseName, description, difficulty, totalHours, modules, specialRequirements.

- For cloud_sandbox path: also fill detectedProvider, and the modules' service lists should use cloud-service short names (ec2, s3, lambda, etc.). Set detectedProvider to "aws", "azure", "gcp", or "multi".
- For container_lab path: fill the containerLab object with the customer's requested VM spec, the stack you're proposing, the per-seat resource budget, estimated savings, and notes. detectedProvider can be omitted for container labs (defaults to whatever the LLM thinks; ops will ignore it for this path).

## Resource sizing for container_lab

When you set per-seat resources, be conservative. Typical big-data stack:
- Kafka + Spark + MySQL: 2 vCPU, 6 GB RAM, 20 GB storage
- + Cassandra: 2 vCPU, 8 GB RAM, 30 GB storage
- MEAN/MERN: 1 vCPU, 2 GB RAM, 10 GB storage
- ELK: 2 vCPU, 6 GB RAM, 30 GB storage (Elasticsearch is heavy)
- Generic Linux + dev tools: 1 vCPU, 2 GB RAM, 10 GB storage

These values should make ops smile — they're way smaller than the customer's requested VM (which is usually overspec'd because the customer is pricing for peak, not average).

## Input variability — CRITICAL

The input PDF quality varies wildly:
- SOMETIMES it's a detailed multi-page TOC with explicit modules, chapters, and lab hours. Extract modules verbatim.
- OFTEN it's a 1-page marketing brief, a short agenda, or a bulleted topic list with NO explicit module breakdown. In that case you MUST INFER reasonable modules from the course topic and description. Use your knowledge of cloud training courses to decompose the subject into 5-10 logical modules with realistic hour estimates.
- NEVER return an empty modules array. If the PDF mentions any cloud technology at all, you can infer modules. Returning zero modules is a failure mode.

## How to infer modules when not explicit

1. Identify the core technology from the title and description (e.g. "Azure Databricks data engineering" → Databricks, Spark, ADLS Gen2, Event Hubs, Cosmos DB, Key Vault).
2. Decompose into standard training topic areas:
   - Foundations / environment setup
   - Core service hands-on (2-4 modules depending on depth)
   - Integration with adjacent services
   - Monitoring / cost / security
   - Capstone / end-to-end lab
3. Estimate hours per module based on typical hands-on training pace:
   - Intro / setup modules: 1-2 hours
   - Core implementation modules: 2-4 hours each
   - Advanced / integration modules: 2-3 hours
4. Typical total hands-on hours by course length:
   - 1-day workshop: 4-6 hours
   - 2-day course: 8-12 hours
   - 3-day course: 12-18 hours
   - 5-day bootcamp: 20-30 hours
   If the PDF doesn't state duration, assume a 3-day course (~15 hours).
5. For each inferred module, list the specific cloud services that would be used during hands-on exercises.

## Service naming

Use lowercase short names matching the provider:
- AWS: ec2, s3, lambda, eks, rds, dynamodb, iam, vpc, cloudwatch, cloudtrail, glue, emr, redshift, sagemaker, kinesis, athena
- Azure: vm, aks, blobstorage, functions, sqldatabase, cosmosdb, keyvault, monitor, databricks, synapse, datafactory, eventhub, adls
- GCP: computeengine, gke, cloudstorage, bigquery, cloudfunctions, cloudsql, firestore, pubsub, dataflow, vertexai

## General rules

- Only count HANDS-ON lab hours where students actually run cloud resources. Skip reading/video/quiz time.
- Be realistic, not minimal. A course that teaches Databricks will use Databricks — don't under-estimate to zero.
- If a course uses expensive services (Glue, SageMaker, Databricks, Synapse, BigQuery), list them honestly. The feasibility engine will flag them for ops review.
- detectedProvider reflects what the course TEACHES, not what it runs on. "Azure Databricks" = azure. "AWS Data Analytics" = aws.
- specialRequirements array: flag unusual needs like "GPU", "multi-region", "cross-account", "hybrid-networking". Empty array if none.
- Respond ONLY by calling the submit_course_analysis tool. No prose.`;

async function analyzeCourseText(text, { providerHint = 'auto', forceType = null } = {}) {
  if (!process.env.CLAUDE_API_KEY) {
    throw new Error('CLAUDE_API_KEY env var is not set');
  }

  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch (e) {
    throw new Error('@anthropic-ai/sdk is not installed. Run: npm install @anthropic-ai/sdk');
  }

  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  // Truncate to stay in budget. We take head + tail to capture both the TOC
  // (usually at start) and any module-level detail (often later).
  let trimmed = text;
  if (text.length > MAX_INPUT_CHARS) {
    const half = Math.floor(MAX_INPUT_CHARS / 2);
    trimmed = text.slice(0, half) + '\n\n[... truncated middle ...]\n\n' + text.slice(-half);
  }

  const providerHintLine = providerHint && providerHint !== 'auto'
    ? `Ops hint: the target cloud provider is ${providerHint.toUpperCase()}. Use this unless the PDF clearly teaches a different one.`
    : `Ops hint: auto-detect the target cloud provider from the content.`;

  // Ops can force the classification when uploading. If they pick "container_lab"
  // they're telling Claude "this is a VM/software-stack course, do NOT classify
  // it as cloud_sandbox no matter what." This overrides the LLM's own judgment.
  let forceTypeLine = '';
  if (forceType === 'cloud_sandbox') {
    forceTypeLine = `\n\nOPS DIRECTIVE: This course is being analyzed as a CLOUD SANDBOX course. You MUST set recommendedDeployment="cloud_sandbox" regardless of what the PDF looks like. Fill in detectedProvider, modules with cloud-service names, etc. Do NOT fill the containerLab object.`;
  } else if (forceType === 'container_lab') {
    forceTypeLine = `\n\nOPS DIRECTIVE: This course is being analyzed as a CONTAINER LAB. You MUST set recommendedDeployment="container_lab" regardless of what the PDF looks like. Fill in the containerLab object with the customer's requested VM spec, the proposed pre-installed stack, and per-seat resources. The modules array can be empty or list logical lab exercises rather than cloud-service-grouped modules.`;
  }

  const userMessage = `${providerHintLine}${forceTypeLine}

--- COURSE PDF TEXT ---
${trimmed}
--- END COURSE PDF TEXT ---

Call submit_course_analysis now with your structured analysis.`;

  const started = Date.now();
  let response;

  // Retry with exponential backoff — Claude returns 529 (Overloaded) during
  // peak hours. 3 retries with 5s/15s/30s waits covers most transient issues.
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [ANALYSIS_TOOL],
        tool_choice: { type: 'tool', name: 'submit_course_analysis' },
        messages: [{ role: 'user', content: userMessage }],
      });
      break; // success
    } catch (err) {
      const isRetryable = err.status === 529 || err.status === 503 || err.status === 500 || err.message?.includes('Overloaded');
      if (isRetryable && attempt < MAX_RETRIES) {
        const waitMs = [5000, 15000, 30000][attempt];
        logger.warn(`[courseAnalyzer] Claude API returned ${err.status || 'error'}, retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      logger.error(`[courseAnalyzer] Claude API call failed after ${attempt + 1} attempts: ${err.message}`);
      throw new Error(`Claude API error: ${err.message}`);
    }
  }

  const toolUse = (response.content || []).find(c => c.type === 'tool_use');
  if (!toolUse || !toolUse.input) {
    logger.error('[courseAnalyzer] Claude did not return a tool_use block', { content: response.content });
    throw new Error('Claude did not return a structured analysis');
  }

  const elapsed = Date.now() - started;
  const usage = response.usage || {};
  logger.info(`[courseAnalyzer] analysis complete in ${elapsed}ms (in:${usage.input_tokens} out:${usage.output_tokens} tokens)`);

  return {
    analysis: toolUse.input,
    meta: {
      model: MODEL,
      elapsedMs: elapsed,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
    },
  };
}

module.exports = { analyzeCourseText };
