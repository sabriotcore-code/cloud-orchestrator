// ============================================================================
// MULTI-AI PROVIDERS SERVICE
// Integrations with multiple AI providers for maximum intelligence
// ============================================================================

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fetch from 'node-fetch';

// ============================================================================
// PROVIDER CONFIGURATIONS
// ============================================================================

const providers = {
  // Claude 3.5 Sonnet (Anthropic)
  claude: {
    client: null,
    model: 'claude-3-5-sonnet-20241022',
    costPer1kIn: 0.003,
    costPer1kOut: 0.015,
    maxTokens: 8192
  },

  // GPT-4o (OpenAI)
  gpt4o: {
    client: null,
    model: 'gpt-4o',
    costPer1kIn: 0.005,
    costPer1kOut: 0.015,
    maxTokens: 4096
  },

  // o1-preview (OpenAI - reasoning)
  o1: {
    client: null,
    model: 'o1-preview',
    costPer1kIn: 0.015,
    costPer1kOut: 0.060,
    maxTokens: 32768
  },

  // Gemini Pro (Google)
  gemini: {
    client: null,
    model: 'gemini-1.5-pro',
    costPer1kIn: 0.00025,
    costPer1kOut: 0.0005,
    maxTokens: 8192
  },

  // Groq (Ultra-fast Llama)
  groq: {
    apiKey: process.env.GROQ_API_KEY,
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.1-70b-versatile',
    costPer1kIn: 0.00059,
    costPer1kOut: 0.00079,
    maxTokens: 8000
  },

  // xAI Grok (Elon's AI - real-time knowledge)
  grok: {
    apiKey: process.env.XAI_API_KEY,
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-beta',
    costPer1kIn: 0.005,
    costPer1kOut: 0.015,
    maxTokens: 8192
  },

  // Perplexity (Real-time web search)
  perplexity: {
    apiKey: process.env.PERPLEXITY_API_KEY,
    baseUrl: 'https://api.perplexity.ai',
    model: 'llama-3.1-sonar-large-128k-online',
    costPer1kIn: 0.001,
    costPer1kOut: 0.001,
    maxTokens: 4096
  },

  // Mistral Large
  mistral: {
    apiKey: process.env.MISTRAL_API_KEY,
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
    costPer1kIn: 0.004,
    costPer1kOut: 0.012,
    maxTokens: 8192
  },

  // Cohere (Reranking & Embeddings)
  cohere: {
    apiKey: process.env.COHERE_API_KEY,
    baseUrl: 'https://api.cohere.ai/v1',
    model: 'command-r-plus',
    costPer1kIn: 0.003,
    costPer1kOut: 0.015,
    maxTokens: 4000
  },

  // Together AI (Open models)
  together: {
    apiKey: process.env.TOGETHER_API_KEY,
    baseUrl: 'https://api.together.xyz/v1',
    model: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    costPer1kIn: 0.0009,
    costPer1kOut: 0.0009,
    maxTokens: 4096
  },

  // DeepSeek (Code-specialized)
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-coder',
    costPer1kIn: 0.00014,
    costPer1kOut: 0.00028,
    maxTokens: 8192
  }
};

// Initialize SDK clients
function initClients() {
  if (process.env.ANTHROPIC_API_KEY && !providers.claude.client) {
    providers.claude.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  if (process.env.OPENAI_API_KEY && !providers.gpt4o.client) {
    providers.gpt4o.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    providers.o1.client = providers.gpt4o.client;
  }
  if (process.env.GEMINI_API_KEY && !providers.gemini.client) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    providers.gemini.client = genAI.getGenerativeModel({ model: providers.gemini.model });
  }
}

// ============================================================================
// STATUS
// ============================================================================

export function getProviderStatus() {
  initClients();
  return {
    claude: !!providers.claude.client,
    gpt4o: !!providers.gpt4o.client,
    o1: !!providers.o1.client,
    gemini: !!providers.gemini.client,
    groq: !!providers.groq.apiKey,
    grok: !!providers.grok.apiKey,
    perplexity: !!providers.perplexity.apiKey,
    mistral: !!providers.mistral.apiKey,
    cohere: !!providers.cohere.apiKey,
    together: !!providers.together.apiKey,
    deepseek: !!providers.deepseek.apiKey
  };
}

// ============================================================================
// UNIFIED CHAT API
// ============================================================================

/**
 * Send a message to any provider
 * @param {string} provider - Provider name (claude, gpt4o, gemini, groq, etc.)
 * @param {string} prompt - The prompt to send
 * @param {object} options - Additional options
 */
export async function chat(provider, prompt, options = {}) {
  initClients();
  const config = providers[provider];
  if (!config) throw new Error(`Unknown provider: ${provider}`);

  const startTime = Date.now();
  let response, tokensIn = 0, tokensOut = 0;

  try {
    switch (provider) {
      case 'claude':
        if (!config.client) throw new Error('Claude not configured');
        const claudeRes = await config.client.messages.create({
          model: config.model,
          max_tokens: options.maxTokens || config.maxTokens,
          system: options.system || 'You are a helpful assistant.',
          messages: [{ role: 'user', content: prompt }]
        });
        response = claudeRes.content[0].text;
        tokensIn = claudeRes.usage?.input_tokens || 0;
        tokensOut = claudeRes.usage?.output_tokens || 0;
        break;

      case 'gpt4o':
      case 'o1':
        if (!config.client) throw new Error('OpenAI not configured');
        const openaiRes = await config.client.chat.completions.create({
          model: config.model,
          max_tokens: options.maxTokens || config.maxTokens,
          messages: [
            ...(options.system ? [{ role: 'system', content: options.system }] : []),
            { role: 'user', content: prompt }
          ]
        });
        response = openaiRes.choices[0].message.content;
        tokensIn = openaiRes.usage?.prompt_tokens || 0;
        tokensOut = openaiRes.usage?.completion_tokens || 0;
        break;

      case 'gemini':
        if (!config.client) throw new Error('Gemini not configured');
        const geminiRes = await config.client.generateContent(prompt);
        response = geminiRes.response.text();
        // Gemini doesn't return exact token counts
        tokensIn = Math.ceil(prompt.length / 4);
        tokensOut = Math.ceil(response.length / 4);
        break;

      case 'groq':
      case 'grok':
      case 'together':
      case 'deepseek':
        response = await callOpenAICompatible(config, prompt, options);
        tokensIn = Math.ceil(prompt.length / 4);
        tokensOut = Math.ceil(response.length / 4);
        break;

      case 'perplexity':
        response = await callPerplexity(prompt, options);
        tokensIn = Math.ceil(prompt.length / 4);
        tokensOut = Math.ceil(response.length / 4);
        break;

      case 'mistral':
        response = await callMistral(prompt, options);
        tokensIn = Math.ceil(prompt.length / 4);
        tokensOut = Math.ceil(response.length / 4);
        break;

      case 'cohere':
        response = await callCohere(prompt, options);
        tokensIn = Math.ceil(prompt.length / 4);
        tokensOut = Math.ceil(response.length / 4);
        break;

      default:
        throw new Error(`Provider ${provider} not implemented`);
    }

    const latencyMs = Date.now() - startTime;
    const cost = (tokensIn / 1000 * config.costPer1kIn) + (tokensOut / 1000 * config.costPer1kOut);

    return {
      provider,
      response,
      tokensIn,
      tokensOut,
      cost,
      latencyMs
    };
  } catch (error) {
    return {
      provider,
      error: error.message,
      latencyMs: Date.now() - startTime
    };
  }
}

// ============================================================================
// OPENAI-COMPATIBLE API CALLER (Groq, Together, DeepSeek)
// ============================================================================

async function callOpenAICompatible(config, prompt, options = {}) {
  if (!config.apiKey) throw new Error(`${config.model} not configured`);

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: options.maxTokens || config.maxTokens,
      messages: [
        ...(options.system ? [{ role: 'system', content: options.system }] : []),
        { role: 'user', content: prompt }
      ]
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

// ============================================================================
// PERPLEXITY (Web Search AI)
// ============================================================================

async function callPerplexity(prompt, options = {}) {
  const config = providers.perplexity;
  if (!config.apiKey) throw new Error('Perplexity not configured');

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: options.system || 'Be precise and concise. Cite sources.' },
        { role: 'user', content: prompt }
      ]
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

/**
 * Search the web using Perplexity
 */
export async function webSearch(query, options = {}) {
  const prompt = `Search the web and provide current information about: ${query}

Include:
1. Key facts and data
2. Recent developments (if applicable)
3. Relevant sources

Be concise but comprehensive.`;

  return await chat('perplexity', prompt, {
    system: 'You are a research assistant. Provide accurate, cited information.',
    ...options
  });
}

// ============================================================================
// MISTRAL
// ============================================================================

async function callMistral(prompt, options = {}) {
  const config = providers.mistral;
  if (!config.apiKey) throw new Error('Mistral not configured');

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: options.maxTokens || config.maxTokens,
      messages: [
        ...(options.system ? [{ role: 'system', content: options.system }] : []),
        { role: 'user', content: prompt }
      ]
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

// ============================================================================
// COHERE
// ============================================================================

async function callCohere(prompt, options = {}) {
  const config = providers.cohere;
  if (!config.apiKey) throw new Error('Cohere not configured');

  const response = await fetch(`${config.baseUrl}/chat`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      message: prompt,
      preamble: options.system || 'You are a helpful assistant.'
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.text;
}

/**
 * Rerank search results using Cohere
 */
export async function rerank(query, documents, topN = 5) {
  const config = providers.cohere;
  if (!config.apiKey) throw new Error('Cohere not configured');

  const response = await fetch(`${config.baseUrl}/rerank`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'rerank-english-v3.0',
      query,
      documents,
      top_n: topN
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.results;
}

// ============================================================================
// CONSENSUS ENGINE
// ============================================================================

/**
 * Query multiple AIs and find consensus
 * @param {string} prompt - The prompt to send
 * @param {string[]} providerList - List of providers to query
 * @param {object} options - Additional options
 */
export async function consensus(prompt, providerList = ['claude', 'gpt4o', 'gemini'], options = {}) {
  const results = await Promise.allSettled(
    providerList.map(p => chat(p, prompt, options))
  );

  const successful = results
    .filter(r => r.status === 'fulfilled' && !r.value.error)
    .map(r => r.value);

  if (successful.length === 0) {
    throw new Error('All providers failed');
  }

  // Calculate total cost and latency
  const totalCost = successful.reduce((sum, r) => sum + (r.cost || 0), 0);
  const avgLatency = successful.reduce((sum, r) => sum + r.latencyMs, 0) / successful.length;

  // Find consensus (simple: pick the most common response theme)
  // For complex consensus, use the synthesize function below
  return {
    responses: successful,
    totalCost,
    avgLatency,
    count: successful.length
  };
}

/**
 * Synthesize multiple AI responses into a single best answer
 */
export async function synthesize(prompt, responses) {
  const synthesisPrompt = `You are synthesizing responses from multiple AI models.

Original question: ${prompt}

AI Responses:
${responses.map((r, i) => `[${r.provider}]: ${r.response}`).join('\n\n')}

Create a single, optimal response that:
1. Combines the best insights from each
2. Resolves any contradictions by choosing the most accurate
3. Is comprehensive yet concise`;

  return await chat('claude', synthesisPrompt, {
    system: 'You are an expert at synthesizing multiple viewpoints into one optimal answer.'
  });
}

// ============================================================================
// SPECIALIZED FUNCTIONS
// ============================================================================

/**
 * Use o1 for complex reasoning tasks
 */
export async function reason(problem, context = '') {
  const prompt = `${context ? `Context: ${context}\n\n` : ''}Problem: ${problem}

Think through this step by step. Consider multiple approaches. Identify potential issues. Provide a well-reasoned solution.`;

  return await chat('o1', prompt, {
    maxTokens: 16000
  });
}

/**
 * Use Groq for ultra-fast responses
 */
export async function fastChat(prompt, options = {}) {
  return await chat('groq', prompt, options);
}

/**
 * Use DeepSeek for code-specific tasks
 */
export async function codeChat(prompt, options = {}) {
  return await chat('deepseek', prompt, {
    system: 'You are an expert programmer. Write clean, efficient, well-documented code.',
    ...options
  });
}

// ============================================================================
// COST TRACKING
// ============================================================================

let sessionCost = 0;
let sessionCalls = 0;

export function trackCost(cost) {
  sessionCost += cost;
  sessionCalls++;
}

export function getSessionStats() {
  return {
    totalCost: sessionCost,
    totalCalls: sessionCalls,
    avgCostPerCall: sessionCalls > 0 ? sessionCost / sessionCalls : 0
  };
}

export function resetSessionStats() {
  sessionCost = 0;
  sessionCalls = 0;
}

export default {
  getProviderStatus,
  chat,
  consensus,
  synthesize,
  webSearch,
  rerank,
  reason,
  fastChat,
  codeChat,
  trackCost,
  getSessionStats,
  resetSessionStats
};
