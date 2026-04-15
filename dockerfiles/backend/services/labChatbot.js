/**
 * Lab Chatbot Service
 *
 * Uses Claude claude-haiku-4-5-20251001 to provide AI-powered lab assistance for students.
 * Stateless: each message is independent (no conversation history stored).
 * Rate-limited: 20 messages per user per hour (in-memory).
 *
 * Env vars:
 *   CLAUDE_API_KEY - required
 */

const { logger } = require('../plugins/logger');

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 300;
const RATE_LIMIT = 20;        // max messages per user per hour
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const SYSTEM_PROMPT = `You are a lab assistant for Synergific Cloud Portal. Help students with their cloud training labs. You can help with: troubleshooting lab access issues, explaining cloud concepts (AWS/Azure/GCP), guiding through lab exercises, explaining error messages. Keep answers concise (under 200 words). Do not help with anything unrelated to cloud training.`;

// In-memory rate limiter: { email: { count, resetAt } }
const rateLimits = new Map();

function checkRateLimit(email) {
  const now = Date.now();
  const entry = rateLimits.get(email);

  if (!entry || now > entry.resetAt) {
    rateLimits.set(email, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }

  if (entry.count >= RATE_LIMIT) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  entry.count += 1;
  return { allowed: true, remaining: RATE_LIMIT - entry.count };
}

/**
 * Send a single message to the lab chatbot.
 *
 * @param {string} message        - The student's question
 * @param {object} context        - { trainingName, labType, imageKey }
 * @param {string} userEmail      - For rate limiting
 * @returns {{ response: string }}
 */
async function chat(message, context = {}, userEmail = 'anonymous') {
  if (!process.env.CLAUDE_API_KEY) {
    throw new Error('CLAUDE_API_KEY env var is not set');
  }

  // Rate limit check
  const rl = checkRateLimit(userEmail);
  if (!rl.allowed) {
    const err = new Error(`Rate limit exceeded. Try again in ${rl.retryAfterSec} seconds.`);
    err.status = 429;
    throw err;
  }

  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch (e) {
    throw new Error('@anthropic-ai/sdk is not installed. Run: npm install @anthropic-ai/sdk');
  }

  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  // Build user message with context
  let userContent = message;
  if (context.trainingName || context.labType || context.imageKey) {
    const parts = [];
    if (context.trainingName) parts.push(`Training: ${context.trainingName}`);
    if (context.labType) parts.push(`Lab type: ${context.labType}`);
    if (context.imageKey) parts.push(`Image: ${context.imageKey}`);
    userContent = `[Context: ${parts.join(', ')}]\n\n${message}`;
  }

  const started = Date.now();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = (response.content || [])
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('');

  const elapsed = Date.now() - started;
  const usage = response.usage || {};
  logger.info(`[labChatbot] response in ${elapsed}ms (in:${usage.input_tokens} out:${usage.output_tokens} tokens) user:${userEmail}`);

  return { response: text };
}

module.exports = { chat };
