// ============================================================================
// TASK ROUTER SERVICE - Smart Task Delegation
// Analyzes tasks and routes them to the optimal handler
// ============================================================================

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// ============================================================================
// CONFIGURATION
// ============================================================================

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// Routing history for learning
const routingHistory = [];

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    intentClassification: true,
    complexityAssessment: true,
    multiAgentRouting: true,
    patternLearning: true,
    routingDecisions: routingHistory.length,
    ready: !!(openai || anthropic)
  };
}

// ============================================================================
// TASK CATEGORIES & HANDLERS
// ============================================================================

/**
 * Available handlers and their capabilities
 */
const HANDLERS = {
  // Simple single-shot handlers
  simple: {
    name: 'Simple Query',
    description: 'Quick, straightforward questions with clear answers',
    complexity: [0, 0.3],
    examples: ['What time is it?', 'Convert 5 miles to km', 'What is React?']
  },

  // Standard processing
  standard: {
    name: 'Standard Processing',
    description: 'Moderate tasks requiring some reasoning',
    complexity: [0.3, 0.6],
    examples: ['Explain how async/await works', 'Compare two approaches', 'Write a function to...']
  },

  // Complex multi-step
  complex: {
    name: 'Complex Multi-Step',
    description: 'Tasks requiring multiple steps, research, or iteration',
    complexity: [0.6, 0.8],
    examples: ['Analyze this dataset', 'Debug this issue', 'Create a plan for...']
  },

  // Crew-level (multi-agent)
  crew: {
    name: 'Multi-Agent Crew',
    description: 'Very complex tasks requiring multiple specialized agents',
    complexity: [0.8, 1.0],
    examples: ['Build a complete feature', 'Research and write a report', 'Design a system']
  }
};

/**
 * Specialized routing categories
 */
const SPECIALIZED_ROUTES = {
  code: {
    keywords: ['code', 'function', 'bug', 'error', 'implement', 'programming', 'script', 'debug'],
    handler: 'coding',
    suggestedCrew: ['architect', 'coder', 'reviewer']
  },
  research: {
    keywords: ['research', 'find', 'search', 'look up', 'what is', 'explain', 'learn about'],
    handler: 'research',
    suggestedCrew: ['researcher', 'analyst', 'writer']
  },
  analysis: {
    keywords: ['analyze', 'compare', 'evaluate', 'assess', 'review', 'breakdown'],
    handler: 'analysis',
    suggestedCrew: ['analyst', 'critic', 'reviewer']
  },
  planning: {
    keywords: ['plan', 'strategy', 'roadmap', 'how to', 'steps to', 'process for'],
    handler: 'planning',
    suggestedCrew: ['planner', 'critic', 'facilitator']
  },
  writing: {
    keywords: ['write', 'draft', 'compose', 'create content', 'document'],
    handler: 'writing',
    suggestedCrew: ['researcher', 'writer', 'reviewer']
  },
  math: {
    keywords: ['calculate', 'compute', 'math', 'formula', 'equation', 'percentage'],
    handler: 'calculation',
    suggestedCrew: ['analyst']
  },
  data: {
    keywords: ['data', 'spreadsheet', 'csv', 'json', 'database', 'sql'],
    handler: 'data_processing',
    suggestedCrew: ['analyst', 'coder']
  },
  creative: {
    keywords: ['idea', 'brainstorm', 'creative', 'design', 'concept'],
    handler: 'creative',
    suggestedCrew: ['facilitator', 'writer', 'critic']
  }
};

// ============================================================================
// INTENT CLASSIFICATION
// ============================================================================

/**
 * Classify the intent of a task using AI
 */
export async function classifyIntent(task) {
  if (!anthropic && !openai) {
    return { category: 'general', confidence: 0.5 };
  }

  const client = anthropic || openai;

  const prompt = `Classify this task into ONE primary category.

TASK: ${task}

CATEGORIES:
- code: Programming, debugging, implementation
- research: Finding information, learning, exploring
- analysis: Data analysis, comparison, evaluation
- planning: Strategy, roadmaps, step-by-step processes
- writing: Content creation, documentation
- math: Calculations, formulas, numerical work
- data: Data processing, transformation
- creative: Ideation, brainstorming, design
- general: Doesn't fit other categories

Return JSON:
{
  "category": "category_name",
  "confidence": 0.0-1.0,
  "subIntent": "more specific description",
  "keywords": ["key", "words", "detected"]
}`;

  let response;
  if (anthropic) {
    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }]
    });
    response = result.content[0].text;
  } else {
    const result = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    response = result.choices[0].message.content;
  }

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    // Fallback to keyword matching
  }

  return classifyByKeywords(task);
}

/**
 * Fallback keyword-based classification
 */
function classifyByKeywords(task) {
  const taskLower = task.toLowerCase();

  for (const [category, config] of Object.entries(SPECIALIZED_ROUTES)) {
    const matchCount = config.keywords.filter(kw => taskLower.includes(kw)).length;
    if (matchCount >= 2 || (matchCount === 1 && task.length < 50)) {
      return {
        category,
        confidence: Math.min(0.3 + matchCount * 0.2, 0.9),
        subIntent: 'keyword_match',
        keywords: config.keywords.filter(kw => taskLower.includes(kw))
      };
    }
  }

  return { category: 'general', confidence: 0.5, subIntent: 'default', keywords: [] };
}

// ============================================================================
// COMPLEXITY ASSESSMENT
// ============================================================================

/**
 * Assess the complexity of a task (0-1 scale)
 */
export async function assessComplexity(task, context = '') {
  if (!anthropic && !openai) {
    return estimateComplexityHeuristic(task);
  }

  const client = anthropic || openai;

  const prompt = `Assess the complexity of this task on a 0-1 scale.

TASK: ${task}
${context ? `CONTEXT: ${context}` : ''}

Consider:
1. Number of steps required (more = higher)
2. Knowledge domains involved (more = higher)
3. Ambiguity level (more = higher)
4. Need for iteration/refinement (yes = higher)
5. External dependencies (more = higher)

Return JSON:
{
  "complexity": 0.0-1.0,
  "factors": {
    "steps": 0.0-1.0,
    "domains": 0.0-1.0,
    "ambiguity": 0.0-1.0,
    "iteration": 0.0-1.0,
    "dependencies": 0.0-1.0
  },
  "estimatedSteps": number,
  "reasoning": "brief explanation"
}`;

  let response;
  if (anthropic) {
    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }]
    });
    response = result.content[0].text;
  } else {
    const result = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    response = result.choices[0].message.content;
  }

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    // Fallback
  }

  return estimateComplexityHeuristic(task);
}

/**
 * Heuristic-based complexity estimation
 */
function estimateComplexityHeuristic(task) {
  const factors = {
    steps: 0.3,
    domains: 0.3,
    ambiguity: 0.3,
    iteration: 0.2,
    dependencies: 0.2
  };

  // Length-based (longer tasks tend to be more complex)
  if (task.length > 500) factors.steps = 0.8;
  else if (task.length > 200) factors.steps = 0.6;
  else if (task.length > 100) factors.steps = 0.4;

  // Keyword-based complexity indicators
  const complexIndicators = ['analyze', 'compare', 'design', 'implement', 'research', 'investigate', 'build', 'create', 'develop'];
  const simpleIndicators = ['what is', 'how do', 'explain', 'tell me', 'show'];

  const taskLower = task.toLowerCase();
  const complexMatches = complexIndicators.filter(i => taskLower.includes(i)).length;
  const simpleMatches = simpleIndicators.filter(i => taskLower.includes(i)).length;

  factors.domains = Math.min(complexMatches * 0.2, 1);
  factors.ambiguity = simpleMatches > complexMatches ? 0.2 : 0.5;

  // Multi-part tasks
  if (task.includes(' and ') || task.includes(' then ') || task.includes('1.') || task.includes('first')) {
    factors.steps = Math.min(factors.steps + 0.2, 1);
  }

  const complexity = Object.values(factors).reduce((a, b) => a + b, 0) / Object.keys(factors).length;

  return {
    complexity: Math.round(complexity * 100) / 100,
    factors,
    estimatedSteps: Math.ceil(complexity * 10),
    reasoning: 'Heuristic estimation based on task characteristics'
  };
}

// ============================================================================
// MAIN ROUTING LOGIC
// ============================================================================

/**
 * Route a task to the optimal handler
 */
export async function route(task, options = {}) {
  const { context = '', forceHandler = null, userPreferences = {} } = options;
  const startTime = Date.now();

  // Force specific handler if requested
  if (forceHandler) {
    return {
      task,
      handler: forceHandler,
      forced: true,
      confidence: 1.0
    };
  }

  // Classify intent and assess complexity in parallel
  const [intent, complexityResult] = await Promise.all([
    classifyIntent(task),
    assessComplexity(task, context)
  ]);

  const complexity = complexityResult.complexity;

  // Determine handler based on complexity
  let handler;
  let handlerConfig;

  if (complexity < 0.3) {
    handler = 'simple';
    handlerConfig = HANDLERS.simple;
  } else if (complexity < 0.6) {
    handler = 'standard';
    handlerConfig = HANDLERS.standard;
  } else if (complexity < 0.8) {
    handler = 'complex';
    handlerConfig = HANDLERS.complex;
  } else {
    handler = 'crew';
    handlerConfig = HANDLERS.crew;
  }

  // Get specialized route info
  const specializedRoute = SPECIALIZED_ROUTES[intent.category];

  // Determine recommended crew if complex enough
  const recommendedCrew = handler === 'crew' || handler === 'complex'
    ? specializedRoute?.suggestedCrew || ['researcher', 'analyst', 'writer']
    : null;

  // Build routing decision
  const decision = {
    task,
    intent,
    complexity: complexityResult,
    handler,
    handlerConfig: {
      name: handlerConfig.name,
      description: handlerConfig.description
    },
    specializedRoute: intent.category,
    recommendedCrew,
    recommendedProcess: complexity > 0.85 ? 'hierarchical' : 'sequential',
    confidence: Math.min(intent.confidence, 1 - Math.abs(complexity - 0.5)),
    routingTimeMs: Date.now() - startTime,
    timestamp: new Date().toISOString()
  };

  // Store in history for learning
  routingHistory.push(decision);
  if (routingHistory.length > 500) routingHistory.shift();

  return decision;
}

/**
 * Quick route without AI (keyword-based only)
 */
export function quickRoute(task) {
  const intent = classifyByKeywords(task);
  const complexity = estimateComplexityHeuristic(task);

  let handler;
  if (complexity.complexity < 0.3) handler = 'simple';
  else if (complexity.complexity < 0.6) handler = 'standard';
  else if (complexity.complexity < 0.8) handler = 'complex';
  else handler = 'crew';

  const specializedRoute = SPECIALIZED_ROUTES[intent.category];

  return {
    task,
    intent,
    complexity,
    handler,
    specializedRoute: intent.category,
    recommendedCrew: specializedRoute?.suggestedCrew || null,
    quick: true
  };
}

// ============================================================================
// BATCH ROUTING
// ============================================================================

/**
 * Route multiple tasks efficiently
 */
export async function routeBatch(tasks, options = {}) {
  const { parallel = true } = options;

  if (parallel) {
    const results = await Promise.all(tasks.map(t => route(t, options)));
    return {
      tasks: results,
      totalCount: tasks.length,
      handlerBreakdown: countByHandler(results)
    };
  }

  // Sequential routing
  const results = [];
  for (const task of tasks) {
    results.push(await route(task, options));
  }

  return {
    tasks: results,
    totalCount: tasks.length,
    handlerBreakdown: countByHandler(results)
  };
}

function countByHandler(results) {
  const counts = {};
  results.forEach(r => {
    counts[r.handler] = (counts[r.handler] || 0) + 1;
  });
  return counts;
}

// ============================================================================
// DECOMPOSITION
// ============================================================================

/**
 * Decompose a complex task into subtasks
 */
export async function decompose(task, options = {}) {
  const { maxSubtasks = 10, minComplexity = 0.3 } = options;

  if (!anthropic && !openai) {
    throw new Error('AI provider required for task decomposition');
  }

  const prompt = `Decompose this complex task into smaller, actionable subtasks.

TASK: ${task}

Requirements:
1. Each subtask should be completable independently or with clear dependencies
2. Subtasks should be ordered logically
3. Maximum ${maxSubtasks} subtasks
4. Each subtask should be specific and actionable

Return JSON:
{
  "subtasks": [
    {
      "id": 1,
      "description": "subtask description",
      "dependencies": [],
      "estimatedComplexity": 0.0-1.0,
      "suggestedHandler": "simple|standard|complex|crew"
    }
  ],
  "totalEstimatedSteps": number,
  "parallelizable": ["task_ids that can run in parallel"],
  "criticalPath": ["task_ids on critical path"]
}`;

  let response;
  if (anthropic) {
    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    });
    response = result.content[0].text;
  } else {
    const result = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    response = result.choices[0].message.content;
  }

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const decomposition = JSON.parse(jsonMatch[0]);

      // Route each subtask
      const routedSubtasks = await Promise.all(
        decomposition.subtasks.map(async st => ({
          ...st,
          routing: await quickRoute(st.description)
        }))
      );

      return {
        originalTask: task,
        subtasks: routedSubtasks,
        parallelizable: decomposition.parallelizable || [],
        criticalPath: decomposition.criticalPath || [],
        totalEstimatedSteps: decomposition.totalEstimatedSteps
      };
    }
  } catch (e) {
    throw new Error(`Decomposition failed: ${e.message}`);
  }
}

// ============================================================================
// HISTORY & ANALYTICS
// ============================================================================

/**
 * Get routing history
 */
export function getRoutingHistory(limit = 50) {
  return routingHistory.slice(-limit);
}

/**
 * Get routing statistics
 */
export function getRoutingStats() {
  if (routingHistory.length === 0) {
    return { message: 'No routing history yet' };
  }

  const handlerCounts = {};
  const intentCounts = {};
  let totalComplexity = 0;
  let totalTime = 0;

  routingHistory.forEach(r => {
    handlerCounts[r.handler] = (handlerCounts[r.handler] || 0) + 1;
    intentCounts[r.intent?.category] = (intentCounts[r.intent?.category] || 0) + 1;
    totalComplexity += r.complexity?.complexity || 0;
    totalTime += r.routingTimeMs || 0;
  });

  return {
    totalDecisions: routingHistory.length,
    handlerBreakdown: handlerCounts,
    intentBreakdown: intentCounts,
    averageComplexity: (totalComplexity / routingHistory.length).toFixed(3),
    averageRoutingTimeMs: Math.round(totalTime / routingHistory.length),
    mostCommonHandler: Object.entries(handlerCounts).sort((a, b) => b[1] - a[1])[0]?.[0],
    mostCommonIntent: Object.entries(intentCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
  };
}

/**
 * Clear routing history
 */
export function clearHistory() {
  routingHistory.length = 0;
  return { success: true, message: 'Routing history cleared' };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Core routing
  route,
  quickRoute,
  routeBatch,
  // Intent & complexity
  classifyIntent,
  assessComplexity,
  // Decomposition
  decompose,
  // History
  getRoutingHistory,
  getRoutingStats,
  clearHistory
};
