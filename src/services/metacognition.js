// ============================================================================
// METACOGNITION SERVICE
// Self-reflection, confidence calibration, cognitive load management
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

// Cognitive state tracking
const cognitiveState = {
  currentTasks: [],
  completedTasks: [],
  errors: [],
  confidenceHistory: [],
  reasoningChains: [],
  lastReflection: null
};

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    metaReasoning: true,
    confidenceCalibration: true,
    cognitiveLoadTracking: true,
    errorRecovery: true,
    activeTasks: cognitiveState.currentTasks.length,
    ready: !!(openai || anthropic)
  };
}

// ============================================================================
// CONFIDENCE CALIBRATION
// ============================================================================

/**
 * Assess confidence in an answer/response
 * @param {string} question - The question asked
 * @param {string} answer - The answer given
 * @param {string} reasoning - How the answer was derived
 */
export async function assessConfidence(question, answer, reasoning = '') {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a metacognitive system that assesses confidence in AI responses.
Analyze the response quality and provide calibrated confidence scores.

Consider:
- Factual accuracy (is this verifiable?)
- Reasoning quality (logical, complete?)
- Knowledge boundaries (is this in training data?)
- Ambiguity (could this be interpreted differently?)
- Hallucination risk (is AI making things up?)`
      },
      {
        role: 'user',
        content: `Assess confidence in this response:

QUESTION: ${question}

ANSWER: ${answer}

${reasoning ? `REASONING: ${reasoning}` : ''}

Provide:
1. Overall confidence (0-100%)
2. Factual confidence (0-100%)
3. Reasoning confidence (0-100%)
4. Key uncertainty factors
5. What would increase confidence
6. Red flags or concerns`
      }
    ],
    response_format: { type: 'json_object' }
  });

  const assessment = JSON.parse(response.choices[0].message.content);

  // Track confidence history
  cognitiveState.confidenceHistory.push({
    timestamp: new Date().toISOString(),
    question: question.substring(0, 100),
    confidence: assessment.overallConfidence || assessment.overall_confidence
  });

  return assessment;
}

/**
 * Self-assess response before sending
 * @param {string} response - The response to assess
 * @param {string} context - Conversation context
 */
export async function selfAssess(response, context = '') {
  if (!anthropic) throw new Error('Anthropic API not configured');

  const result = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Before sending this response, perform a self-assessment:

RESPONSE TO SEND:
${response}

${context ? `CONTEXT:\n${context}` : ''}

Check for:
1. Factual errors or unsupported claims
2. Logical inconsistencies
3. Missing important caveats
4. Potential misunderstandings
5. Tone appropriateness
6. Completeness

Return JSON with:
{
  "shouldSend": true/false,
  "confidence": 0-100,
  "issues": ["list of issues"],
  "suggestions": ["improvements"],
  "revisedResponse": "improved version if needed"
}`
    }]
  });

  try {
    const text = result.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: text };
  } catch {
    return { raw: result.content[0].text };
  }
}

// ============================================================================
// META-REASONING
// ============================================================================

/**
 * Reflect on reasoning process
 * @param {string} problem - The problem being solved
 * @param {string[]} steps - Reasoning steps taken
 * @param {string} conclusion - The conclusion reached
 */
export async function reflectOnReasoning(problem, steps, conclusion) {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a metacognitive system that reflects on reasoning processes.
Analyze the reasoning chain for:
- Logical validity
- Cognitive biases
- Gaps or jumps in logic
- Alternative approaches
- Strength of evidence`
      },
      {
        role: 'user',
        content: `Reflect on this reasoning process:

PROBLEM: ${problem}

STEPS TAKEN:
${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

CONCLUSION: ${conclusion}

Analyze:
1. Is the reasoning valid?
2. What assumptions were made?
3. What biases might be present?
4. What alternative approaches exist?
5. How strong is the evidence?
6. What would change the conclusion?`
      }
    ]
  });

  const reflection = response.choices[0].message.content;

  cognitiveState.reasoningChains.push({
    timestamp: new Date().toISOString(),
    problem: problem.substring(0, 100),
    stepsCount: steps.length,
    reflection: reflection.substring(0, 500)
  });

  cognitiveState.lastReflection = new Date().toISOString();

  return {
    problem,
    conclusion,
    reflection,
    stepsAnalyzed: steps.length
  };
}

/**
 * Identify cognitive biases in reasoning
 */
export async function detectBiases(reasoning) {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are an expert in cognitive biases. Identify biases in reasoning.

Common biases to check:
- Confirmation bias
- Anchoring
- Availability heuristic
- Dunning-Kruger effect
- Sunk cost fallacy
- Hindsight bias
- Bandwagon effect
- Authority bias
- Recency bias
- Survivorship bias`
      },
      {
        role: 'user',
        content: `Analyze this reasoning for cognitive biases:

${reasoning}

For each bias detected:
1. Name the bias
2. Where it appears in the reasoning
3. How it affects the conclusion
4. How to correct for it`
      }
    ]
  });

  return {
    reasoning: reasoning.substring(0, 200),
    biasAnalysis: response.choices[0].message.content
  };
}

/**
 * Choose optimal reasoning strategy
 * @param {string} problemType - Type of problem
 * @param {object} constraints - Time, resources, etc.
 */
export async function selectReasoningStrategy(problemType, constraints = {}) {
  const strategies = {
    analytical: {
      name: 'Analytical',
      description: 'Step-by-step logical analysis',
      bestFor: ['math', 'logic', 'debugging'],
      timeRequired: 'high',
      accuracy: 'high'
    },
    intuitive: {
      name: 'Intuitive',
      description: 'Pattern-based quick assessment',
      bestFor: ['creative', 'brainstorming', 'exploration'],
      timeRequired: 'low',
      accuracy: 'medium'
    },
    analogical: {
      name: 'Analogical',
      description: 'Finding similar solved problems',
      bestFor: ['novel problems', 'cross-domain'],
      timeRequired: 'medium',
      accuracy: 'medium'
    },
    decomposition: {
      name: 'Decomposition',
      description: 'Breaking into sub-problems',
      bestFor: ['complex', 'multi-step'],
      timeRequired: 'high',
      accuracy: 'high'
    },
    simulation: {
      name: 'Mental Simulation',
      description: 'Imagining scenarios and outcomes',
      bestFor: ['prediction', 'planning', 'risk'],
      timeRequired: 'medium',
      accuracy: 'medium'
    }
  };

  // Score each strategy based on problem type and constraints
  const scores = Object.entries(strategies).map(([key, strategy]) => {
    let score = 0;

    // Match to problem type
    if (strategy.bestFor.some(t => problemType.toLowerCase().includes(t))) {
      score += 3;
    }

    // Time constraints
    if (constraints.timeLimit === 'low' && strategy.timeRequired === 'low') {
      score += 2;
    } else if (constraints.timeLimit === 'high' && strategy.timeRequired === 'high') {
      score += 1;
    }

    // Accuracy requirements
    if (constraints.accuracyRequired === 'high' && strategy.accuracy === 'high') {
      score += 2;
    }

    return { key, ...strategy, score };
  });

  scores.sort((a, b) => b.score - a.score);

  return {
    problemType,
    constraints,
    recommended: scores[0],
    alternatives: scores.slice(1, 3),
    allStrategies: scores
  };
}

// ============================================================================
// COGNITIVE LOAD MANAGEMENT
// ============================================================================

/**
 * Track current cognitive load
 */
export function trackCognitiveLoad() {
  const activeTasks = cognitiveState.currentTasks.length;
  const recentErrors = cognitiveState.errors.filter(e =>
    Date.now() - new Date(e.timestamp).getTime() < 300000 // Last 5 minutes
  ).length;

  // Calculate load score (0-100)
  let loadScore = 0;
  loadScore += activeTasks * 15; // Each task adds 15
  loadScore += recentErrors * 10; // Each error adds 10
  loadScore = Math.min(100, loadScore);

  const status = loadScore < 30 ? 'low' :
                 loadScore < 60 ? 'moderate' :
                 loadScore < 80 ? 'high' : 'overloaded';

  return {
    loadScore,
    status,
    activeTasks,
    recentErrors,
    recommendations: getLoadRecommendations(status)
  };
}

function getLoadRecommendations(status) {
  const recommendations = {
    low: ['Good capacity for complex tasks', 'Can take on additional work'],
    moderate: ['Consider prioritizing tasks', 'Group similar tasks together'],
    high: ['Complete current tasks before new ones', 'Delegate if possible', 'Take breaks'],
    overloaded: ['Pause new tasks', 'Focus on one thing at a time', 'Reduce complexity']
  };
  return recommendations[status];
}

/**
 * Add task to tracking
 */
export function startTask(taskId, description, complexity = 'medium') {
  cognitiveState.currentTasks.push({
    id: taskId,
    description,
    complexity,
    startTime: new Date().toISOString()
  });

  return trackCognitiveLoad();
}

/**
 * Complete task tracking
 */
export function completeTask(taskId, success = true) {
  const taskIndex = cognitiveState.currentTasks.findIndex(t => t.id === taskId);

  if (taskIndex >= 0) {
    const task = cognitiveState.currentTasks.splice(taskIndex, 1)[0];
    task.endTime = new Date().toISOString();
    task.success = success;
    cognitiveState.completedTasks.push(task);

    // Keep only last 100 completed tasks
    if (cognitiveState.completedTasks.length > 100) {
      cognitiveState.completedTasks.shift();
    }
  }

  return trackCognitiveLoad();
}

/**
 * Log error for tracking
 */
export function logError(error, context = '') {
  cognitiveState.errors.push({
    timestamp: new Date().toISOString(),
    error: error.message || error,
    context
  });

  // Keep only last 50 errors
  if (cognitiveState.errors.length > 50) {
    cognitiveState.errors.shift();
  }

  return trackCognitiveLoad();
}

// ============================================================================
// ERROR RECOVERY
// ============================================================================

/**
 * Analyze error and suggest recovery
 */
export async function analyzeError(error, context) {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are an expert at error analysis and recovery. Provide actionable solutions.`
      },
      {
        role: 'user',
        content: `Analyze this error and suggest recovery:

ERROR: ${error.message || error}
${error.stack ? `STACK: ${error.stack}` : ''}

CONTEXT: ${context}

Provide:
1. Root cause analysis
2. Immediate fix
3. Retry strategy (if applicable)
4. Prevention measures
5. Alternative approaches`
      }
    ]
  });

  logError(error, context);

  return {
    error: error.message || error,
    analysis: response.choices[0].message.content,
    cognitiveLoad: trackCognitiveLoad()
  };
}

/**
 * Automatic retry with backoff
 */
export async function retryWithBackoff(fn, maxRetries = 3, baseDelayMs = 1000) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      logError(error, `Retry attempt ${attempt + 1}/${maxRetries}`);

      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// ============================================================================
// HIERARCHICAL PLANNING
// ============================================================================

/**
 * Decompose complex goal into sub-goals
 */
export async function decomposeGoal(goal, context = '') {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are an expert at hierarchical goal decomposition.
Break complex goals into manageable sub-goals with clear dependencies.`
      },
      {
        role: 'user',
        content: `Decompose this goal into a hierarchical plan:

GOAL: ${goal}
${context ? `CONTEXT: ${context}` : ''}

Provide:
1. Main sub-goals (high level)
2. For each sub-goal:
   - Specific tasks
   - Dependencies on other sub-goals
   - Estimated complexity (low/medium/high)
   - Success criteria
3. Optimal execution order
4. Parallelizable tasks
5. Critical path items`
      }
    ]
  });

  return {
    goal,
    decomposition: response.choices[0].message.content
  };
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

/**
 * Get current cognitive state
 */
export function getCognitiveState() {
  return {
    currentTasks: cognitiveState.currentTasks,
    completedTasksCount: cognitiveState.completedTasks.length,
    recentErrors: cognitiveState.errors.slice(-10),
    recentConfidence: cognitiveState.confidenceHistory.slice(-10),
    lastReflection: cognitiveState.lastReflection,
    cognitiveLoad: trackCognitiveLoad()
  };
}

/**
 * Reset cognitive state
 */
export function resetCognitiveState() {
  cognitiveState.currentTasks = [];
  cognitiveState.completedTasks = [];
  cognitiveState.errors = [];
  cognitiveState.confidenceHistory = [];
  cognitiveState.reasoningChains = [];
  cognitiveState.lastReflection = null;

  return { success: true, message: 'Cognitive state reset' };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Confidence
  assessConfidence,
  selfAssess,
  // Meta-reasoning
  reflectOnReasoning,
  detectBiases,
  selectReasoningStrategy,
  // Cognitive load
  trackCognitiveLoad,
  startTask,
  completeTask,
  logError,
  // Error recovery
  analyzeError,
  retryWithBackoff,
  // Planning
  decomposeGoal,
  // State
  getCognitiveState,
  resetCognitiveState
};
