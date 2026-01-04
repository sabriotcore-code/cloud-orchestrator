// ============================================================================
// EXTENDED AI PROVIDERS - More AI Models for Diverse Reasoning
// Auto-registers with Cognitive Orchestrator
// ============================================================================

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// ============================================================================
// PROVIDER CLIENTS
// ============================================================================

// Groq - Ultra-fast inference (Llama, Mixtral)
const groq = process.env.GROQ_API_KEY
  ? new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1'
    })
  : null;

// Mistral - Efficient European AI
const mistral = process.env.MISTRAL_API_KEY
  ? new OpenAI({
      apiKey: process.env.MISTRAL_API_KEY,
      baseURL: 'https://api.mistral.ai/v1'
    })
  : null;

// Together AI - Open source models
const together = process.env.TOGETHER_API_KEY
  ? new OpenAI({
      apiKey: process.env.TOGETHER_API_KEY,
      baseURL: 'https://api.together.xyz/v1'
    })
  : null;

// DeepSeek - Code-focused AI
const deepseek = process.env.DEEPSEEK_API_KEY
  ? new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com/v1'
    })
  : null;

// Cohere - Semantic search & reranking
const COHERE_API_KEY = process.env.COHERE_API_KEY;

// Fireworks AI - Fast open models
const fireworks = process.env.FIREWORKS_API_KEY
  ? new OpenAI({
      apiKey: process.env.FIREWORKS_API_KEY,
      baseURL: 'https://api.fireworks.ai/inference/v1'
    })
  : null;

// OpenRouter - Access to many models
const openrouter = process.env.OPENROUTER_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1'
    })
  : null;

// ============================================================================
// GROQ - Ultra Fast Inference
// ============================================================================

export async function askGroq(prompt, options = {}) {
  if (!groq) throw new Error('Groq not configured - set GROQ_API_KEY');

  const {
    model = 'llama-3.1-70b-versatile',
    system = 'You are a helpful AI assistant.',
    maxTokens = 4096,
    temperature = 0.7
  } = options;

  const response = await groq.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ],
    max_tokens: maxTokens,
    temperature
  });

  return response.choices[0].message.content;
}

export async function groqFast(prompt, options = {}) {
  return askGroq(prompt, { ...options, model: 'llama-3.1-8b-instant' });
}

export async function groqMixtral(prompt, options = {}) {
  return askGroq(prompt, { ...options, model: 'mixtral-8x7b-32768' });
}

// ============================================================================
// MISTRAL - Efficient Reasoning
// ============================================================================

export async function askMistral(prompt, options = {}) {
  if (!mistral) throw new Error('Mistral not configured - set MISTRAL_API_KEY');

  const {
    model = 'mistral-large-latest',
    system = 'You are a helpful AI assistant.',
    maxTokens = 4096,
    temperature = 0.7
  } = options;

  const response = await mistral.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ],
    max_tokens: maxTokens,
    temperature
  });

  return response.choices[0].message.content;
}

export async function mistralSmall(prompt, options = {}) {
  return askMistral(prompt, { ...options, model: 'mistral-small-latest' });
}

export async function mistralCodestral(prompt, options = {}) {
  return askMistral(prompt, { ...options, model: 'codestral-latest' });
}

// ============================================================================
// TOGETHER AI - Open Source Models
// ============================================================================

export async function askTogether(prompt, options = {}) {
  if (!together) throw new Error('Together not configured - set TOGETHER_API_KEY');

  const {
    model = 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    system = 'You are a helpful AI assistant.',
    maxTokens = 4096,
    temperature = 0.7
  } = options;

  const response = await together.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ],
    max_tokens: maxTokens,
    temperature
  });

  return response.choices[0].message.content;
}

export async function togetherQwen(prompt, options = {}) {
  return askTogether(prompt, { ...options, model: 'Qwen/Qwen2.5-72B-Instruct-Turbo' });
}

export async function togetherDeepseek(prompt, options = {}) {
  return askTogether(prompt, { ...options, model: 'deepseek-ai/DeepSeek-V2.5' });
}

// ============================================================================
// DEEPSEEK - Code-Focused AI
// ============================================================================

export async function askDeepSeek(prompt, options = {}) {
  if (!deepseek) throw new Error('DeepSeek not configured - set DEEPSEEK_API_KEY');

  const {
    model = 'deepseek-chat',
    system = 'You are a helpful AI assistant.',
    maxTokens = 4096,
    temperature = 0.7
  } = options;

  const response = await deepseek.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ],
    max_tokens: maxTokens,
    temperature
  });

  return response.choices[0].message.content;
}

export async function deepseekCoder(prompt, options = {}) {
  return askDeepSeek(prompt, {
    ...options,
    model: 'deepseek-coder',
    system: 'You are an expert programmer. Write clean, efficient code.'
  });
}

// ============================================================================
// COHERE - Semantic Search & Reranking
// ============================================================================

export async function cohereEmbed(texts, options = {}) {
  if (!COHERE_API_KEY) throw new Error('Cohere not configured - set COHERE_API_KEY');

  const { model = 'embed-english-v3.0', inputType = 'search_document' } = options;

  const response = await fetch('https://api.cohere.ai/v1/embed', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${COHERE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      texts: Array.isArray(texts) ? texts : [texts],
      model,
      input_type: inputType
    })
  });

  const data = await response.json();
  return data.embeddings;
}

export async function cohereRerank(query, documents, options = {}) {
  if (!COHERE_API_KEY) throw new Error('Cohere not configured - set COHERE_API_KEY');

  const { model = 'rerank-english-v3.0', topN = 10 } = options;

  const response = await fetch('https://api.cohere.ai/v1/rerank', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${COHERE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query,
      documents,
      model,
      top_n: topN
    })
  });

  const data = await response.json();
  return data.results;
}

export async function cohereChat(message, options = {}) {
  if (!COHERE_API_KEY) throw new Error('Cohere not configured - set COHERE_API_KEY');

  const { model = 'command-r-plus', preamble = '' } = options;

  const response = await fetch('https://api.cohere.ai/v1/chat', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${COHERE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message,
      model,
      preamble
    })
  });

  const data = await response.json();
  return data.text;
}

// ============================================================================
// FIREWORKS - Fast Open Models
// ============================================================================

export async function askFireworks(prompt, options = {}) {
  if (!fireworks) throw new Error('Fireworks not configured - set FIREWORKS_API_KEY');

  const {
    model = 'accounts/fireworks/models/llama-v3p1-70b-instruct',
    system = 'You are a helpful AI assistant.',
    maxTokens = 4096,
    temperature = 0.7
  } = options;

  const response = await fireworks.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ],
    max_tokens: maxTokens,
    temperature
  });

  return response.choices[0].message.content;
}

// ============================================================================
// OPENROUTER - Access to Many Models
// ============================================================================

export async function askOpenRouter(prompt, options = {}) {
  if (!openrouter) throw new Error('OpenRouter not configured - set OPENROUTER_API_KEY');

  const {
    model = 'anthropic/claude-3.5-sonnet',
    system = 'You are a helpful AI assistant.',
    maxTokens = 4096,
    temperature = 0.7
  } = options;

  const response = await openrouter.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ],
    max_tokens: maxTokens,
    temperature
  });

  return response.choices[0].message.content;
}

// Access specific models via OpenRouter
export async function openRouterGPT4(prompt, options = {}) {
  return askOpenRouter(prompt, { ...options, model: 'openai/gpt-4-turbo' });
}

export async function openRouterClaude(prompt, options = {}) {
  return askOpenRouter(prompt, { ...options, model: 'anthropic/claude-3.5-sonnet' });
}

export async function openRouterGemini(prompt, options = {}) {
  return askOpenRouter(prompt, { ...options, model: 'google/gemini-pro-1.5' });
}

// ============================================================================
// MULTI-MODEL CONSENSUS
// ============================================================================

export async function multiModelConsensus(prompt, options = {}) {
  const { models = ['groq', 'mistral', 'together'], timeout = 30000 } = options;

  const providers = {
    groq: groq ? () => askGroq(prompt, options) : null,
    mistral: mistral ? () => askMistral(prompt, options) : null,
    together: together ? () => askTogether(prompt, options) : null,
    deepseek: deepseek ? () => askDeepSeek(prompt, options) : null,
    fireworks: fireworks ? () => askFireworks(prompt, options) : null,
    cohere: COHERE_API_KEY ? () => cohereChat(prompt, options) : null
  };

  const activeProviders = models.filter(m => providers[m]);
  if (activeProviders.length === 0) {
    throw new Error('No providers available for consensus');
  }

  const results = await Promise.allSettled(
    activeProviders.map(m =>
      Promise.race([
        providers[m]().then(r => ({ provider: m, response: r })),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
      ])
    )
  );

  const successful = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  return {
    responses: successful,
    count: successful.length,
    attempted: activeProviders.length
  };
}

// ============================================================================
// SPECIALIZED REASONING
// ============================================================================

export async function codeReasoning(prompt, options = {}) {
  // Use code-focused models
  const providers = [];

  if (deepseek) providers.push(deepseekCoder(prompt, options).then(r => ({ provider: 'deepseek', response: r })));
  if (mistral) providers.push(mistralCodestral(prompt, options).then(r => ({ provider: 'mistral-codestral', response: r })));
  if (groq) providers.push(askGroq(prompt, { ...options, system: 'You are an expert programmer.' }).then(r => ({ provider: 'groq', response: r })));

  if (providers.length === 0) throw new Error('No code providers available');

  const results = await Promise.allSettled(providers);
  return results.filter(r => r.status === 'fulfilled').map(r => r.value);
}

export async function fastReasoning(prompt, options = {}) {
  // Use fastest models for quick responses
  if (groq) return { provider: 'groq', response: await groqFast(prompt, options) };
  if (fireworks) return { provider: 'fireworks', response: await askFireworks(prompt, options) };
  if (together) return { provider: 'together', response: await askTogether(prompt, options) };
  throw new Error('No fast providers available');
}

export async function deepReasoning(prompt, options = {}) {
  // Use largest/smartest models
  const providers = [];

  if (mistral) providers.push(askMistral(prompt, { ...options, model: 'mistral-large-latest' }).then(r => ({ provider: 'mistral-large', response: r })));
  if (together) providers.push(togetherQwen(prompt, options).then(r => ({ provider: 'qwen-72b', response: r })));
  if (groq) providers.push(askGroq(prompt, { ...options, model: 'llama-3.1-70b-versatile' }).then(r => ({ provider: 'llama-70b', response: r })));

  if (providers.length === 0) throw new Error('No deep reasoning providers available');

  const results = await Promise.allSettled(providers);
  return results.filter(r => r.status === 'fulfilled').map(r => r.value);
}

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    groq: !!groq,
    mistral: !!mistral,
    together: !!together,
    deepseek: !!deepseek,
    cohere: !!COHERE_API_KEY,
    fireworks: !!fireworks,
    openrouter: !!openrouter,
    availableProviders: [
      groq && 'groq',
      mistral && 'mistral',
      together && 'together',
      deepseek && 'deepseek',
      COHERE_API_KEY && 'cohere',
      fireworks && 'fireworks',
      openrouter && 'openrouter'
    ].filter(Boolean),
    ready: !!(groq || mistral || together || deepseek || COHERE_API_KEY || fireworks || openrouter)
  };
}

// ============================================================================
// AUTO-REGISTER WITH ORCHESTRATOR
// ============================================================================

export async function registerWithOrchestrator(orchestrator) {
  const { registerPlugin } = orchestrator;

  if (groq) {
    registerPlugin('groq', {
      category: 'reasoning',
      capabilities: ['fast_inference', 'llama', 'mixtral'],
      intents: [/\b(fast|quick|instant)\s+(answer|response)\b/i],
      priority: 85,
      handler: async (input, ctx) => ({ response: await groqFast(input, ctx) }),
      module: { askGroq, groqFast, groqMixtral }
    });
  }

  if (mistral) {
    registerPlugin('mistral', {
      category: 'reasoning',
      capabilities: ['efficient_reasoning', 'codestral', 'european_ai'],
      intents: [/\b(efficient|balanced)\s+(reasoning|analysis)\b/i],
      priority: 70,
      handler: async (input, ctx) => ({ response: await askMistral(input, ctx) }),
      module: { askMistral, mistralSmall, mistralCodestral }
    });
  }

  if (COHERE_API_KEY) {
    registerPlugin('cohere', {
      category: 'analysis',
      capabilities: ['semantic_search', 'reranking', 'embeddings'],
      intents: [/\b(rerank|semantic|embed|similar)\b/i],
      priority: 75,
      handler: async (input, ctx) => {
        if (/rerank/i.test(input) && ctx.documents) {
          return { results: await cohereRerank(input, ctx.documents) };
        }
        return { response: await cohereChat(input) };
      },
      module: { cohereEmbed, cohereRerank, cohereChat }
    });
  }

  if (deepseek) {
    registerPlugin('deepseek', {
      category: 'execution',
      capabilities: ['code_generation', 'code_analysis', 'debugging'],
      intents: [/\b(deepseek|code expert)\b/i],
      priority: 72,
      handler: async (input, ctx) => ({ response: await deepseekCoder(input, ctx) }),
      module: { askDeepSeek, deepseekCoder }
    });
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Groq
  askGroq, groqFast, groqMixtral,
  // Mistral
  askMistral, mistralSmall, mistralCodestral,
  // Together
  askTogether, togetherQwen, togetherDeepseek,
  // DeepSeek
  askDeepSeek, deepseekCoder,
  // Cohere
  cohereEmbed, cohereRerank, cohereChat,
  // Fireworks
  askFireworks,
  // OpenRouter
  askOpenRouter, openRouterGPT4, openRouterClaude, openRouterGemini,
  // Multi-model
  multiModelConsensus,
  // Specialized
  codeReasoning, fastReasoning, deepReasoning,
  // Registration
  registerWithOrchestrator
};
