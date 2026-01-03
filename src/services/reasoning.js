/**
 * MULTI-MODEL REASONING ORCHESTRA
 *
 * Coordinates multiple AI models for complex reasoning tasks:
 * - Chain-of-thought decomposition
 * - Specialist routing (code, analysis, creative, factual)
 * - Debate/critique loop for better answers
 * - Confidence-weighted synthesis
 * - Automatic complexity assessment
 */

import * as db from '../db/index.js';
import * as aiProviders from './ai-providers.js';

// ============================================================================
// MODEL SPECIALIZATIONS
// ============================================================================

const MODEL_SPECS = {
  claude: {
    name: 'Claude',
    strengths: ['reasoning', 'analysis', 'code_review', 'nuanced_discussion'],
    speed: 'medium',
    costTier: 'high',
    bestFor: ['complex_reasoning', 'ethical_considerations', 'detailed_analysis']
  },
  gpt4: {
    name: 'GPT-4o',
    strengths: ['general', 'creative', 'coding', 'structured_output'],
    speed: 'medium',
    costTier: 'high',
    bestFor: ['code_generation', 'creative_writing', 'general_tasks']
  },
  gemini: {
    name: 'Gemini',
    strengths: ['multimodal', 'factual', 'search', 'summarization'],
    speed: 'fast',
    costTier: 'medium',
    bestFor: ['fact_checking', 'research', 'data_analysis']
  },
  groq: {
    name: 'Groq',
    strengths: ['speed', 'simple_tasks', 'extraction'],
    speed: 'ultrafast',
    costTier: 'low',
    bestFor: ['quick_answers', 'classification', 'extraction']
  },
  perplexity: {
    name: 'Perplexity',
    strengths: ['realtime', 'search', 'current_events'],
    speed: 'medium',
    costTier: 'medium',
    bestFor: ['current_info', 'web_search', 'news']
  }
};

// ============================================================================
// TASK COMPLEXITY ASSESSMENT
// ============================================================================

/**
 * Assess complexity of a query
 */
export function assessComplexity(query) {
  const factors = {
    length: query.length,
    questionCount: (query.match(/\?/g) || []).length,
    hasCode: /```|function|class|import|const|let|var/.test(query),
    hasAnalysis: /analyze|compare|evaluate|assess|review/.test(query.toLowerCase()),
    hasCreative: /write|create|generate|design|imagine/.test(query.toLowerCase()),
    hasFactual: /what is|who is|when|where|how many|define/.test(query.toLowerCase()),
    hasReasoning: /why|explain|because|reason|logic|think/.test(query.toLowerCase()),
    hasMultiStep: /first|then|next|finally|step|process/.test(query.toLowerCase()),
  };

  let score = 0;

  // Length contribution
  if (factors.length > 500) score += 2;
  else if (factors.length > 200) score += 1;

  // Multi-question
  if (factors.questionCount > 2) score += 2;
  else if (factors.questionCount > 1) score += 1;

  // Type bonuses
  if (factors.hasCode) score += 2;
  if (factors.hasAnalysis) score += 2;
  if (factors.hasReasoning) score += 2;
  if (factors.hasMultiStep) score += 1;
  if (factors.hasCreative) score += 1;

  return {
    score,
    level: score >= 5 ? 'high' : score >= 3 ? 'medium' : 'low',
    factors,
    recommendedApproach: score >= 5 ? 'orchestra' : score >= 3 ? 'specialist' : 'single'
  };
}

/**
 * Determine task type for routing
 */
export function classifyTaskType(query) {
  const lowerQuery = query.toLowerCase();

  const types = [];

  if (/```|code|function|bug|error|implement|refactor/.test(lowerQuery)) {
    types.push('coding');
  }
  if (/analyze|compare|evaluate|pros.*cons|trade.?off/.test(lowerQuery)) {
    types.push('analysis');
  }
  if (/write|create|story|poem|creative|imagine/.test(lowerQuery)) {
    types.push('creative');
  }
  if (/what is|define|explain|how does|fact|data/.test(lowerQuery)) {
    types.push('factual');
  }
  if (/latest|news|current|today|recent|2024|2025/.test(lowerQuery)) {
    types.push('realtime');
  }
  if (/why|reason|logic|argument|debate|ethics/.test(lowerQuery)) {
    types.push('reasoning');
  }

  return types.length > 0 ? types : ['general'];
}

// ============================================================================
// MODEL SELECTION
// ============================================================================

/**
 * Select best model(s) for task
 */
export function selectModels(taskTypes, complexity, options = {}) {
  const { preferSpeed = false, preferQuality = false, maxModels = 3 } = options;

  const candidates = [];

  for (const [modelId, spec] of Object.entries(MODEL_SPECS)) {
    let score = 0;

    // Match task types to strengths
    for (const taskType of taskTypes) {
      if (spec.bestFor.some(bf => bf.includes(taskType) || taskType.includes(bf))) {
        score += 3;
      }
      if (spec.strengths.includes(taskType)) {
        score += 2;
      }
    }

    // Adjust for preferences
    if (preferSpeed && spec.speed === 'ultrafast') score += 2;
    if (preferSpeed && spec.speed === 'fast') score += 1;
    if (preferQuality && spec.costTier === 'high') score += 2;

    // Adjust for complexity
    if (complexity.level === 'high' && spec.costTier === 'high') score += 2;
    if (complexity.level === 'low' && spec.speed === 'ultrafast') score += 2;

    candidates.push({ modelId, spec, score });
  }

  // Sort by score and return top models
  candidates.sort((a, b) => b.score - a.score);

  return candidates.slice(0, maxModels).map(c => c.modelId);
}

// ============================================================================
// CHAIN OF THOUGHT
// ============================================================================

/**
 * Decompose complex query into reasoning steps
 */
export async function decomposeQuery(query) {
  const prompt = `Decompose this query into clear reasoning steps. Return JSON array of steps.
Each step should have: {step: number, task: "what to do", type: "analysis|research|synthesis|evaluation"}

Query: ${query}

Return ONLY valid JSON array, no other text.`;

  try {
    const result = await aiProviders.fastChat(prompt);
    const json = extractJson(result.response || result);

    if (Array.isArray(json)) {
      return json;
    }
  } catch (e) {
    console.error('[Reasoning] Decomposition failed:', e.message);
  }

  // Fallback: simple decomposition
  return [
    { step: 1, task: 'Understand the question', type: 'analysis' },
    { step: 2, task: 'Gather relevant information', type: 'research' },
    { step: 3, task: 'Formulate response', type: 'synthesis' }
  ];
}

/**
 * Execute chain of thought reasoning
 */
export async function chainOfThought(query, options = {}) {
  const { verbose = false } = options;

  const steps = await decomposeQuery(query);
  const results = [];
  let context = '';

  for (const step of steps) {
    const stepPrompt = `
Previous context: ${context || 'None'}

Current step: ${step.task}
Original query: ${query}

Complete this step and provide your analysis.`;

    const model = step.type === 'research' ? 'gemini' : 'claude';
    const response = await queryModel(model, stepPrompt);

    results.push({
      step: step.step,
      task: step.task,
      model,
      response: response.content
    });

    context += `\nStep ${step.step}: ${response.content.substring(0, 500)}`;
  }

  // Final synthesis
  const synthesisPrompt = `
Based on this step-by-step analysis, provide a final comprehensive answer.

Steps completed:
${results.map(r => `${r.step}. ${r.task}: ${r.response.substring(0, 300)}`).join('\n')}

Original query: ${query}

Provide clear, actionable final answer.`;

  const finalResponse = await queryModel('claude', synthesisPrompt);

  return {
    query,
    steps: results,
    finalAnswer: finalResponse.content,
    reasoning: verbose ? results : undefined
  };
}

// ============================================================================
// DEBATE / CRITIQUE LOOP
// ============================================================================

/**
 * Run debate between models for better answer
 */
export async function debateLoop(query, options = {}) {
  const { rounds = 2, models = ['claude', 'gpt4'] } = options;

  const debate = {
    query,
    rounds: [],
    finalAnswer: null
  };

  let currentAnswer = null;

  for (let round = 0; round < rounds; round++) {
    const roundResponses = [];

    for (const model of models) {
      let prompt;

      if (round === 0) {
        prompt = `Answer this question thoughtfully: ${query}`;
      } else {
        prompt = `Previous answer was: "${currentAnswer}"

Question: ${query}

Review the previous answer. If you agree, expand on it. If you disagree or see issues, provide a better answer with your reasoning.`;
      }

      const response = await queryModel(model, prompt);
      roundResponses.push({
        model,
        response: response.content,
        confidence: response.confidence || 0.7
      });
    }

    debate.rounds.push(roundResponses);

    // Select best answer for next round
    const bestResponse = roundResponses.reduce((best, curr) =>
      (curr.confidence > best.confidence) ? curr : best
    );
    currentAnswer = bestResponse.response;
  }

  // Final synthesis
  const allResponses = debate.rounds.flat();
  const synthesisPrompt = `
Multiple AI models debated this question: ${query}

Their responses:
${allResponses.map((r, i) => `[${r.model}]: ${String(r.response || '').substring(0, 400)}`).join('\n\n')}

Synthesize the best elements from all responses into one optimal answer.`;

  const synthesis = await queryModel('claude', synthesisPrompt);
  debate.finalAnswer = synthesis.content;

  return debate;
}

// ============================================================================
// PARALLEL ENSEMBLE
// ============================================================================

/**
 * Query multiple models in parallel and synthesize
 */
export async function ensembleQuery(query, options = {}) {
  const complexity = assessComplexity(query);
  const taskTypes = classifyTaskType(query);
  const models = options.models || selectModels(taskTypes, complexity);

  console.log(`[Reasoning] Ensemble query with models: ${models.join(', ')}`);

  // Query all models in parallel
  const promises = models.map(model =>
    queryModel(model, query).then(r => ({ model, ...r }))
  );

  const results = await Promise.allSettled(promises);

  const responses = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  if (responses.length === 0) {
    throw new Error('All models failed');
  }

  if (responses.length === 1) {
    return {
      query,
      models: [responses[0].model],
      answer: responses[0].content,
      confidence: responses[0].confidence || 0.7
    };
  }

  // Synthesize multiple responses
  const synthesisPrompt = `
Question: ${query}

Multiple AI models provided these answers:
${responses.map(r => `[${r.model}]: ${String(r.content || '(no response)')}`).join('\n\n---\n\n')}

Synthesize these into one optimal answer that:
1. Takes the best elements from each
2. Resolves any contradictions
3. Provides a clear, complete response`;

  const synthesis = await queryModel('claude', synthesisPrompt);

  // Calculate combined confidence
  const avgConfidence = responses.reduce((sum, r) => sum + (r.confidence || 0.7), 0) / responses.length;

  return {
    query,
    models: responses.map(r => r.model),
    individualResponses: responses,
    answer: synthesis.content,
    confidence: Math.min(avgConfidence + 0.1, 0.95) // Boost for ensemble
  };
}

// ============================================================================
// SPECIALIST ROUTING
// ============================================================================

/**
 * Route to specialist model based on task
 */
export async function specialistQuery(query, options = {}) {
  const taskTypes = classifyTaskType(query);
  const primaryType = taskTypes[0];

  let model;
  switch (primaryType) {
    case 'coding':
      model = 'gpt4'; // Best for code generation
      break;
    case 'realtime':
      model = 'perplexity'; // Has web search
      break;
    case 'reasoning':
    case 'analysis':
      model = 'claude'; // Best for nuanced reasoning
      break;
    case 'factual':
      model = 'gemini'; // Good for facts
      break;
    default:
      model = 'groq'; // Fast for simple tasks
  }

  console.log(`[Reasoning] Specialist routing: ${primaryType} -> ${model}`);

  const response = await queryModel(model, query);

  return {
    query,
    taskType: primaryType,
    model,
    answer: response.content,
    confidence: response.confidence || 0.7
  };
}

// ============================================================================
// ORCHESTRATED REASONING
// ============================================================================

/**
 * Main entry point - automatically selects best approach
 */
export async function reason(query, options = {}) {
  const complexity = assessComplexity(query);
  const taskTypes = classifyTaskType(query);

  console.log(`[Reasoning] Complexity: ${complexity.level}, Types: ${taskTypes.join(', ')}`);

  let result;

  switch (complexity.recommendedApproach) {
    case 'orchestra':
      // High complexity: full ensemble with debate
      if (taskTypes.includes('reasoning') || taskTypes.includes('analysis')) {
        result = await debateLoop(query, options);
        result.approach = 'debate';
      } else {
        result = await ensembleQuery(query, options);
        result.approach = 'ensemble';
      }
      break;

    case 'specialist':
      // Medium complexity: route to specialist
      result = await specialistQuery(query, options);
      result.approach = 'specialist';
      break;

    case 'single':
    default:
      // Low complexity: fast single model
      const response = await queryModel('groq', query);
      result = {
        query,
        model: 'groq',
        answer: response.content,
        confidence: response.confidence || 0.8,
        approach: 'fast'
      };
  }

  result.complexity = complexity;
  result.taskTypes = taskTypes;

  return result;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Query a specific model
 */
async function queryModel(model, prompt) {
  try {
    let response;

    // Map model names to ai-providers format
    const providerMap = {
      'claude': 'claude',
      'gpt4': 'gpt4o',
      'gemini': 'gemini',
      'groq': 'groq',
      'perplexity': 'perplexity'
    };

    const provider = providerMap[model] || 'groq';

    if (provider === 'groq') {
      response = await aiProviders.fastChat(prompt);
    } else {
      response = await aiProviders.chat(provider, prompt);
    }

    return {
      content: response.response || response.content || response,
      confidence: response.confidence || 0.7,
      model
    };
  } catch (e) {
    console.error(`[Reasoning] Model ${model} failed:`, e.message);
    return {
      content: `Error from ${model}: ${e.message}`,
      confidence: 0,
      model,
      error: true
    };
  }
}

/**
 * Extract JSON from text
 */
function extractJson(text) {
  try {
    // Try direct parse first
    return JSON.parse(text);
  } catch (e) {
    // Try to find JSON in text
    const match = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}

export default {
  assessComplexity,
  classifyTaskType,
  selectModels,
  decomposeQuery,
  chainOfThought,
  debateLoop,
  ensembleQuery,
  specialistQuery,
  reason
};
