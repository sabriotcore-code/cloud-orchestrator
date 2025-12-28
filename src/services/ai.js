import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import * as db from '../db/index.js';

// Load environment variables first
dotenv.config();

// ============================================================================
// AI CLIENTS (lazy initialization)
// ============================================================================

let anthropic = null;
let openai = null;
let genai = null;

function getAnthropicClient() {
  if (!anthropic && process.env.ANTHROPIC_API_KEY) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

function getOpenAIClient() {
  if (!openai && process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

function getGeminiClient() {
  if (!genai && process.env.GEMINI_API_KEY) {
    genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genai;
}

// Cost rates per 1M tokens
const COST_RATES = {
  claude: { input: 3.00, output: 15.00 },    // Claude Sonnet
  gpt: { input: 2.50, output: 10.00 },       // GPT-4o
  gemini: { input: 0.10, output: 0.40 },     // Gemini 2.0 Flash
};

// ============================================================================
// PROMPTS
// ============================================================================

export const PROMPTS = {
  review: `You are a senior software architect on a real-time review panel.
Analyze the following content and provide CONCISE feedback:

1. ISSUES (1-3 bullets) - Critical problems only
2. SUGGESTIONS (1-3 bullets) - Top improvements
3. QUESTIONS (1-3 bullets) - Clarifying questions for the developer

Be direct. No fluff. Max 200 words total.

CONTENT:
`,

  challenge: `You are a critical code reviewer. Challenge this approach:

1. WHAT COULD GO WRONG? (2-3 risks)
2. ALTERNATIVE APPROACHES? (1-2 options)
3. WHAT ARE YOU MISSING? (1-2 blind spots)

Be provocative. Push back. Max 150 words.

CONTENT:
`,

  consensus: `You are an AI consensus builder. Given these responses from different AI models,
synthesize the best answer by:
1. Identifying points of agreement
2. Resolving contradictions
3. Combining unique insights

Return a single, unified response that represents the best combined answer.

RESPONSES:
`,

  general: `You are a helpful AI assistant. Be concise and direct.

`,
};

// ============================================================================
// INDIVIDUAL AI QUERIES
// ============================================================================

export async function askClaude(content, systemPrompt = PROMPTS.general) {
  const startTime = Date.now();
  const client = getAnthropicClient();
  if (!client) {
    return { provider: 'claude', error: 'ANTHROPIC_API_KEY not configured', latencyMs: 0, success: false };
  }
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: systemPrompt + content }],
    });

    const tokensIn = response.usage?.input_tokens || 0;
    const tokensOut = response.usage?.output_tokens || 0;
    const costUsd = calculateCost('claude', tokensIn, tokensOut);
    const latencyMs = Date.now() - startTime;

    // Log to database
    await db.logUsage('claude', tokensIn, tokensOut, costUsd, 'messages.create');

    return {
      provider: 'claude',
      response: response.content[0].text,
      tokensIn,
      tokensOut,
      costUsd,
      latencyMs,
      success: true,
    };
  } catch (error) {
    return {
      provider: 'claude',
      error: error.message,
      latencyMs: Date.now() - startTime,
      success: false,
    };
  }
}

export async function askGPT(content, systemPrompt = PROMPTS.general) {
  const startTime = Date.now();
  const client = getOpenAIClient();
  if (!client) {
    return { provider: 'gpt', error: 'OPENAI_API_KEY not configured', latencyMs: 0, success: false };
  }
  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2048,
      messages: [{ role: 'user', content: systemPrompt + content }],
    });

    const tokensIn = response.usage?.prompt_tokens || 0;
    const tokensOut = response.usage?.completion_tokens || 0;
    const costUsd = calculateCost('gpt', tokensIn, tokensOut);
    const latencyMs = Date.now() - startTime;

    // Log to database
    await db.logUsage('gpt', tokensIn, tokensOut, costUsd, 'chat.completions');

    return {
      provider: 'gpt',
      response: response.choices[0].message.content,
      tokensIn,
      tokensOut,
      costUsd,
      latencyMs,
      success: true,
    };
  } catch (error) {
    return {
      provider: 'gpt',
      error: error.message,
      latencyMs: Date.now() - startTime,
      success: false,
    };
  }
}

export async function askGemini(content, systemPrompt = PROMPTS.general) {
  const startTime = Date.now();
  const client = getGeminiClient();
  if (!client) {
    return { provider: 'gemini', error: 'GEMINI_API_KEY not configured', latencyMs: 0, success: false };
  }
  try {
    const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(systemPrompt + content);

    const usageMetadata = result.response.usageMetadata || {};
    const tokensIn = usageMetadata.promptTokenCount || 0;
    const tokensOut = usageMetadata.candidatesTokenCount || 0;
    const costUsd = calculateCost('gemini', tokensIn, tokensOut);
    const latencyMs = Date.now() - startTime;

    // Log to database
    await db.logUsage('gemini', tokensIn, tokensOut, costUsd, 'generateContent');

    return {
      provider: 'gemini',
      response: result.response.text(),
      tokensIn,
      tokensOut,
      costUsd,
      latencyMs,
      success: true,
    };
  } catch (error) {
    return {
      provider: 'gemini',
      error: error.message,
      latencyMs: Date.now() - startTime,
      success: false,
    };
  }
}

// ============================================================================
// MULTI-AI QUERY (Parallel)
// ============================================================================

export async function askAll(content, promptType = 'general') {
  const prompt = PROMPTS[promptType] || PROMPTS.general;

  console.log(`[AI] Querying all 3 AIs in parallel (${promptType} mode)...`);

  const [claude, gpt, gemini] = await Promise.all([
    askClaude(content, prompt),
    askGPT(content, prompt),
    askGemini(content, prompt),
  ]);

  const results = { claude, gpt, gemini };

  // Log summary
  const totalCost = [claude, gpt, gemini]
    .filter(r => r.success)
    .reduce((sum, r) => sum + (r.costUsd || 0), 0);

  console.log(`[AI] Completed. Total cost: $${totalCost.toFixed(6)}`);

  return results;
}

// ============================================================================
// CONSENSUS ENGINE
// ============================================================================

export async function buildConsensus(results, method = 'weighted') {
  const successfulResponses = Object.entries(results)
    .filter(([_, r]) => r.success)
    .map(([provider, r]) => ({ provider, response: r.response, latency: r.latencyMs }));

  if (successfulResponses.length === 0) {
    return { success: false, error: 'All AI providers failed' };
  }

  if (successfulResponses.length === 1) {
    return {
      success: true,
      method: 'single',
      winner: successfulResponses[0].provider,
      response: successfulResponses[0].response,
      reasoning: 'Only one provider returned a response',
    };
  }

  switch (method) {
    case 'fastest':
      // Return the fastest response
      const fastest = successfulResponses.sort((a, b) => a.latency - b.latency)[0];
      return {
        success: true,
        method: 'fastest',
        winner: fastest.provider,
        response: fastest.response,
        reasoning: `${fastest.provider} responded in ${fastest.latency}ms`,
      };

    case 'weighted':
      // Use Claude to synthesize (it's the most capable)
      const combinedResponses = successfulResponses
        .map(r => `[${r.provider.toUpperCase()}]:\n${r.response}`)
        .join('\n\n---\n\n');

      const synthesis = await askClaude(combinedResponses, PROMPTS.consensus);

      if (synthesis.success) {
        return {
          success: true,
          method: 'weighted',
          winner: 'consensus',
          response: synthesis.response,
          reasoning: 'Synthesized from all provider responses',
          sources: successfulResponses.map(r => r.provider),
        };
      }

      // Fallback to Claude's original response
      return {
        success: true,
        method: 'fallback',
        winner: 'claude',
        response: results.claude?.response || successfulResponses[0].response,
        reasoning: 'Consensus synthesis failed, using Claude response',
      };

    case 'majority':
    default:
      // For now, prefer Claude > GPT > Gemini
      const priority = ['claude', 'gpt', 'gemini'];
      for (const provider of priority) {
        if (results[provider]?.success) {
          return {
            success: true,
            method: 'priority',
            winner: provider,
            response: results[provider].response,
            reasoning: `Using ${provider} (highest priority available)`,
          };
        }
      }
  }

  return { success: false, error: 'No consensus could be reached' };
}

// ============================================================================
// HELPERS
// ============================================================================

function calculateCost(provider, tokensIn, tokensOut) {
  const rates = COST_RATES[provider];
  if (!rates) return 0;
  return (tokensIn / 1000000) * rates.input + (tokensOut / 1000000) * rates.output;
}

export function getProviderStatus() {
  return {
    claude: !!process.env.ANTHROPIC_API_KEY,
    gpt: !!process.env.OPENAI_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
  };
}
