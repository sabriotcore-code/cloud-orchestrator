/**
 * AUTOML OPTIMIZER
 *
 * Automated model selection and optimization:
 * - Provider/model benchmarking
 * - Prompt optimization
 * - Cost-performance balancing
 * - A/B testing for AI responses
 * - Automatic fallback chains
 */

import * as db from '../db/index.js';
import * as aiProviders from './ai-providers.js';

// ============================================================================
// MODEL BENCHMARKING
// ============================================================================

/**
 * Benchmark multiple models on the same task
 */
export async function benchmarkModels(prompt, options = {}) {
  const {
    models = ['groq', 'claude', 'gpt4o', 'gemini'],
    iterations = 1,
    metrics = ['latency', 'cost', 'quality']
  } = options;

  const results = {};

  for (const model of models) {
    results[model] = {
      responses: [],
      avgLatency: 0,
      avgCost: 0,
      errors: 0
    };

    for (let i = 0; i < iterations; i++) {
      try {
        const start = Date.now();
        const response = await aiProviders.chat(model, prompt);
        const latency = Date.now() - start;

        results[model].responses.push({
          content: response.response?.substring(0, 500),
          latency,
          cost: response.cost || estimateCost(model, prompt, response.response),
          iteration: i + 1
        });
      } catch (e) {
        results[model].errors++;
        results[model].responses.push({ error: e.message, iteration: i + 1 });
      }
    }

    // Calculate averages
    const successful = results[model].responses.filter(r => !r.error);
    if (successful.length > 0) {
      results[model].avgLatency = successful.reduce((a, r) => a + r.latency, 0) / successful.length;
      results[model].avgCost = successful.reduce((a, r) => a + r.cost, 0) / successful.length;
      results[model].successRate = (successful.length / iterations * 100).toFixed(1) + '%';
    }
  }

  // Rank models
  const rankings = rankModels(results, metrics);

  return {
    prompt: prompt.substring(0, 100),
    iterations,
    results,
    rankings,
    recommendation: rankings[0]
  };
}

/**
 * Estimate cost for a request
 */
function estimateCost(model, prompt, response) {
  const costs = {
    groq: { in: 0.0001, out: 0.0002 },
    claude: { in: 0.003, out: 0.015 },
    gpt4o: { in: 0.005, out: 0.015 },
    gemini: { in: 0.00025, out: 0.0005 }
  };

  const modelCost = costs[model] || costs.groq;
  const inputTokens = Math.ceil((prompt?.length || 0) / 4);
  const outputTokens = Math.ceil((response?.length || 0) / 4);

  return (inputTokens * modelCost.in + outputTokens * modelCost.out) / 1000;
}

/**
 * Rank models based on metrics
 */
function rankModels(results, metrics) {
  const scores = {};

  for (const [model, data] of Object.entries(results)) {
    scores[model] = 0;

    if (metrics.includes('latency') && data.avgLatency > 0) {
      // Lower latency = higher score (inverse)
      scores[model] += 1000 / data.avgLatency;
    }

    if (metrics.includes('cost') && data.avgCost > 0) {
      // Lower cost = higher score (inverse)
      scores[model] += 1 / data.avgCost;
    }

    if (metrics.includes('quality')) {
      // Measure quality by response length and success rate
      const successRate = parseFloat(data.successRate) || 0;
      scores[model] += successRate / 10;
    }
  }

  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([model, score]) => ({ model, score: score.toFixed(2) }));
}

// ============================================================================
// PROMPT OPTIMIZATION
// ============================================================================

/**
 * Optimize prompt for better results
 */
export async function optimizePrompt(basePrompt, options = {}) {
  const { goal = 'accuracy', examples = [], constraints = [] } = options;

  const optimizationPrompt = `You are a prompt engineering expert. Optimize this prompt for ${goal}.

Original prompt:
"${basePrompt}"

${examples.length > 0 ? `Example inputs/outputs:\n${examples.map(e => `- Input: ${e.input}\n  Expected: ${e.expected}`).join('\n')}` : ''}

${constraints.length > 0 ? `Constraints:\n${constraints.map(c => `- ${c}`).join('\n')}` : ''}

Provide 3 optimized versions:
1. Minimal changes (small tweaks)
2. Restructured (same intent, better structure)
3. Enhanced (with techniques like few-shot, chain-of-thought)

Return JSON array with fields: version, prompt, technique, expectedImprovement`;

  try {
    const response = await aiProviders.chat('claude', optimizationPrompt);
    const parsed = JSON.parse(response.response.match(/\[[\s\S]*\]/)?.[0] || '[]');

    return {
      original: basePrompt,
      optimized: parsed,
      goal,
      model: 'claude'
    };
  } catch (e) {
    return {
      original: basePrompt,
      error: e.message,
      optimized: []
    };
  }
}

/**
 * Test optimized prompts
 */
export async function testPromptVariants(variants, testInput, options = {}) {
  const { model = 'groq', evaluationCriteria = ['relevance', 'completeness'] } = options;

  const results = [];

  for (const variant of variants) {
    const fullPrompt = variant.prompt + '\n\nInput: ' + testInput;
    const start = Date.now();

    try {
      const response = await aiProviders.chat(model, fullPrompt);
      const latency = Date.now() - start;

      results.push({
        version: variant.version,
        prompt: variant.prompt.substring(0, 100),
        response: response.response?.substring(0, 300),
        latency,
        technique: variant.technique
      });
    } catch (e) {
      results.push({
        version: variant.version,
        error: e.message
      });
    }
  }

  return {
    testInput,
    model,
    results,
    recommendation: results.find(r => !r.error)?.version || 'none'
  };
}

// ============================================================================
// COST-PERFORMANCE OPTIMIZATION
// ============================================================================

/**
 * Find optimal model for cost-performance balance
 */
export async function optimizeCostPerformance(taskType, options = {}) {
  const { budget = 'medium', latencyRequirement = 'normal' } = options;

  const profiles = {
    // Task type -> recommended models
    'simple-qa': { cheap: 'groq', balanced: 'gemini', premium: 'gpt4o' },
    'code-generation': { cheap: 'groq', balanced: 'claude', premium: 'claude' },
    'analysis': { cheap: 'gemini', balanced: 'gpt4o', premium: 'claude' },
    'creative': { cheap: 'gemini', balanced: 'claude', premium: 'claude' },
    'summarization': { cheap: 'groq', balanced: 'gemini', premium: 'gpt4o' },
    'classification': { cheap: 'groq', balanced: 'groq', premium: 'gpt4o' }
  };

  const budgetMap = { low: 'cheap', medium: 'balanced', high: 'premium' };
  const profile = profiles[taskType] || profiles['simple-qa'];
  const recommendation = profile[budgetMap[budget] || 'balanced'];

  return {
    taskType,
    budget,
    latencyRequirement,
    recommendation,
    alternatives: Object.entries(profile).map(([tier, model]) => ({ tier, model })),
    rationale: `For ${taskType} with ${budget} budget, ${recommendation} offers best balance.`
  };
}

// ============================================================================
// A/B TESTING
// ============================================================================

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS ab_experiments (
        id SERIAL PRIMARY KEY,
        experiment_id VARCHAR(100) UNIQUE,
        name TEXT,
        variants JSONB,
        metrics JSONB DEFAULT '{}',
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS ab_results (
        id SERIAL PRIMARY KEY,
        experiment_id VARCHAR(100),
        variant VARCHAR(50),
        outcome JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    schemaReady = true;
  } catch (e) {
    console.error('[AutoML] Schema error:', e.message);
  }
}

/**
 * Create A/B experiment
 */
export async function createExperiment(name, variants) {
  await ensureSchema();

  const experimentId = `exp_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  await db.query(`
    INSERT INTO ab_experiments (experiment_id, name, variants)
    VALUES ($1, $2, $3)
  `, [experimentId, name, JSON.stringify(variants)]);

  return {
    experimentId,
    name,
    variants,
    created: true
  };
}

/**
 * Get variant for experiment (weighted random)
 */
export async function getVariant(experimentId) {
  await ensureSchema();

  const result = await db.query(`
    SELECT variants FROM ab_experiments WHERE experiment_id = $1 AND status = 'active'
  `, [experimentId]);

  if (result.rows.length === 0) {
    return { error: 'Experiment not found or inactive' };
  }

  const variants = result.rows[0].variants;
  const totalWeight = variants.reduce((sum, v) => sum + (v.weight || 1), 0);
  let random = Math.random() * totalWeight;

  for (const variant of variants) {
    random -= (variant.weight || 1);
    if (random <= 0) {
      return {
        experimentId,
        variant: variant.name,
        config: variant.config || {}
      };
    }
  }

  return { experimentId, variant: variants[0].name };
}

/**
 * Record experiment outcome
 */
export async function recordOutcome(experimentId, variant, outcome) {
  await ensureSchema();

  await db.query(`
    INSERT INTO ab_results (experiment_id, variant, outcome)
    VALUES ($1, $2, $3)
  `, [experimentId, variant, JSON.stringify(outcome)]);

  // Update aggregate metrics
  const results = await db.query(`
    SELECT variant, COUNT(*) as count,
           AVG((outcome->>'success')::int) as success_rate,
           AVG((outcome->>'latency')::float) as avg_latency
    FROM ab_results
    WHERE experiment_id = $1
    GROUP BY variant
  `, [experimentId]);

  const metrics = {};
  results.rows.forEach(r => {
    metrics[r.variant] = {
      count: parseInt(r.count),
      successRate: parseFloat(r.success_rate || 0),
      avgLatency: parseFloat(r.avg_latency || 0)
    };
  });

  await db.query(`
    UPDATE ab_experiments SET metrics = $1 WHERE experiment_id = $2
  `, [JSON.stringify(metrics), experimentId]);

  return { recorded: true, currentMetrics: metrics };
}

/**
 * Get experiment results
 */
export async function getExperimentResults(experimentId) {
  await ensureSchema();

  const experiment = await db.query(`
    SELECT * FROM ab_experiments WHERE experiment_id = $1
  `, [experimentId]);

  if (experiment.rows.length === 0) {
    return { error: 'Experiment not found' };
  }

  const results = await db.query(`
    SELECT variant, outcome, created_at
    FROM ab_results
    WHERE experiment_id = $1
    ORDER BY created_at DESC
    LIMIT 100
  `, [experimentId]);

  return {
    experiment: experiment.rows[0],
    results: results.rows,
    winner: determineWinner(experiment.rows[0].metrics)
  };
}

/**
 * Determine winning variant
 */
function determineWinner(metrics) {
  if (!metrics || Object.keys(metrics).length === 0) {
    return { winner: null, reason: 'Insufficient data' };
  }

  let bestVariant = null;
  let bestScore = -1;

  for (const [variant, data] of Object.entries(metrics)) {
    // Score = success rate * (1 / normalized latency)
    const score = data.successRate * (data.count > 10 ? 1 : 0.5);
    if (score > bestScore) {
      bestScore = score;
      bestVariant = variant;
    }
  }

  return {
    winner: bestVariant,
    score: bestScore.toFixed(2),
    reason: 'Based on success rate and sample size'
  };
}

// ============================================================================
// FALLBACK CHAINS
// ============================================================================

/**
 * Execute with automatic fallback
 */
export async function executeWithFallback(prompt, options = {}) {
  const {
    chain = ['groq', 'gemini', 'claude', 'gpt4o'],
    timeout = 30000
  } = options;

  for (const model of chain) {
    try {
      const start = Date.now();
      const response = await Promise.race([
        aiProviders.chat(model, prompt),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), timeout)
        )
      ]);

      return {
        response: response.response,
        model,
        latency: Date.now() - start,
        fallbackUsed: model !== chain[0]
      };
    } catch (e) {
      console.log(`[AutoML] ${model} failed: ${e.message}, trying next...`);
      continue;
    }
  }

  return { error: 'All models in fallback chain failed' };
}

/**
 * Build optimized fallback chain for task type
 */
export function buildFallbackChain(taskType, options = {}) {
  const { prioritize = 'reliability' } = options;

  const chains = {
    reliability: {
      'code': ['claude', 'gpt4o', 'gemini', 'groq'],
      'analysis': ['gpt4o', 'claude', 'gemini', 'groq'],
      'creative': ['claude', 'gpt4o', 'gemini', 'groq'],
      'default': ['groq', 'gemini', 'claude', 'gpt4o']
    },
    speed: {
      'code': ['groq', 'gemini', 'claude', 'gpt4o'],
      'analysis': ['groq', 'gemini', 'gpt4o', 'claude'],
      'creative': ['groq', 'gemini', 'claude', 'gpt4o'],
      'default': ['groq', 'gemini', 'claude', 'gpt4o']
    },
    cost: {
      'code': ['groq', 'gemini', 'claude', 'gpt4o'],
      'analysis': ['groq', 'gemini', 'gpt4o', 'claude'],
      'creative': ['gemini', 'groq', 'claude', 'gpt4o'],
      'default': ['groq', 'gemini', 'gpt4o', 'claude']
    }
  };

  const priorityChains = chains[prioritize] || chains.reliability;
  return priorityChains[taskType] || priorityChains.default;
}

export default {
  // Benchmarking
  benchmarkModels,

  // Prompt optimization
  optimizePrompt,
  testPromptVariants,

  // Cost-performance
  optimizeCostPerformance,

  // A/B testing
  createExperiment,
  getVariant,
  recordOutcome,
  getExperimentResults,

  // Fallback
  executeWithFallback,
  buildFallbackChain
};
