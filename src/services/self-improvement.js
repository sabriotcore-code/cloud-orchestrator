// ============================================================================
// SELF-IMPROVEMENT - Learning, Optimization, Error Analysis, Feedback Loops
// Meta-cognitive abilities for continuous improvement
// ============================================================================

import OpenAI from 'openai';

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ============================================================================
// PERFORMANCE TRACKING
// ============================================================================

const performanceLog = [];
const errorLog = [];
const feedbackLog = [];
const learnings = [];
const optimizationHistory = [];

/**
 * Log performance metrics
 */
export function logPerformance(operation, metrics) {
  const entry = {
    timestamp: new Date().toISOString(),
    operation,
    ...metrics
  };
  performanceLog.push(entry);

  // Keep last 1000 entries
  if (performanceLog.length > 1000) {
    performanceLog.shift();
  }

  return entry;
}

/**
 * Get performance statistics
 */
export function getPerformanceStats(operation = null, timeRange = '24h') {
  const now = Date.now();
  const ranges = {
    '1h': 3600000,
    '24h': 86400000,
    '7d': 604800000,
    '30d': 2592000000
  };

  const cutoff = now - (ranges[timeRange] || ranges['24h']);

  let filtered = performanceLog.filter(entry =>
    new Date(entry.timestamp).getTime() > cutoff
  );

  if (operation) {
    filtered = filtered.filter(entry => entry.operation === operation);
  }

  if (filtered.length === 0) {
    return { count: 0, message: 'No data for specified criteria' };
  }

  const durations = filtered.map(e => e.duration).filter(d => typeof d === 'number');
  const successes = filtered.filter(e => e.success === true).length;
  const failures = filtered.filter(e => e.success === false).length;

  return {
    count: filtered.length,
    successRate: (successes / filtered.length) * 100,
    failureRate: (failures / filtered.length) * 100,
    duration: durations.length > 0 ? {
      avg: durations.reduce((a, b) => a + b, 0) / durations.length,
      min: Math.min(...durations),
      max: Math.max(...durations),
      p95: percentile(durations, 95)
    } : null,
    byOperation: groupBy(filtered, 'operation'),
    trend: calculateTrend(filtered)
  };
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[index];
}

function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key];
    acc[k] = acc[k] || [];
    acc[k].push(item);
    return acc;
  }, {});
}

function calculateTrend(entries) {
  if (entries.length < 2) return 'insufficient_data';

  const sorted = entries.sort((a, b) =>
    new Date(a.timestamp) - new Date(b.timestamp)
  );

  const halfPoint = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, halfPoint);
  const secondHalf = sorted.slice(halfPoint);

  const firstAvg = firstHalf.filter(e => e.success).length / firstHalf.length;
  const secondAvg = secondHalf.filter(e => e.success).length / secondHalf.length;

  if (secondAvg > firstAvg + 0.05) return 'improving';
  if (secondAvg < firstAvg - 0.05) return 'declining';
  return 'stable';
}

// ============================================================================
// ERROR ANALYSIS
// ============================================================================

/**
 * Log error for analysis
 */
export function logError(error, context = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    error: {
      message: error.message || error,
      stack: error.stack,
      name: error.name
    },
    context,
    analyzed: false
  };

  errorLog.push(entry);

  if (errorLog.length > 500) {
    errorLog.shift();
  }

  return entry;
}

/**
 * Analyze error patterns
 */
export async function analyzeErrors(options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { timeRange = '24h', limit = 50 } = options;

  const now = Date.now();
  const ranges = { '1h': 3600000, '24h': 86400000, '7d': 604800000 };
  const cutoff = now - (ranges[timeRange] || ranges['24h']);

  const recentErrors = errorLog
    .filter(e => new Date(e.timestamp).getTime() > cutoff)
    .slice(-limit);

  if (recentErrors.length === 0) {
    return { patterns: [], recommendations: [], message: 'No recent errors' };
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Analyze error patterns and provide actionable insights.
Return JSON:
{
  "patterns": [
    {
      "type": "pattern type",
      "frequency": number,
      "description": "what's happening",
      "rootCause": "likely root cause",
      "affectedOperations": ["op1", "op2"]
    }
  ],
  "criticalIssues": ["most important issues to address"],
  "recommendations": [
    {"priority": "high/medium/low", "action": "what to do", "expectedImpact": "..."}
  ],
  "systemHealth": 0-100,
  "summary": "overall error analysis"
}`
      },
      {
        role: 'user',
        content: `Errors:\n${JSON.stringify(recentErrors, null, 2)}`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  const analysis = JSON.parse(response.choices[0].message.content);

  // Mark errors as analyzed
  recentErrors.forEach(e => e.analyzed = true);

  return analysis;
}

/**
 * Auto-fix common errors
 */
export async function suggestErrorFix(error, context = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Diagnose error and suggest fixes.
Return JSON:
{
  "diagnosis": "what caused this error",
  "fixes": [
    {
      "type": "code_change/config_change/retry/escalate",
      "description": "what to do",
      "code": "code fix if applicable",
      "confidence": 0-1
    }
  ],
  "prevention": "how to prevent this in the future",
  "relatedDocs": ["documentation links if known"]
}`
      },
      {
        role: 'user',
        content: `Error: ${JSON.stringify(error)}\nContext: ${JSON.stringify(context)}`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1500
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// FEEDBACK LEARNING
// ============================================================================

/**
 * Record feedback
 */
export function recordFeedback(feedback) {
  const entry = {
    timestamp: new Date().toISOString(),
    ...feedback,
    processed: false
  };

  feedbackLog.push(entry);

  if (feedbackLog.length > 1000) {
    feedbackLog.shift();
  }

  return entry;
}

/**
 * Learn from feedback
 */
export async function learnFromFeedback(options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const unprocessed = feedbackLog.filter(f => !f.processed);

  if (unprocessed.length === 0) {
    return { learned: [], message: 'No new feedback to process' };
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Extract learnings from user feedback. Identify patterns and preferences.
Return JSON:
{
  "learnings": [
    {
      "category": "preference/behavior/capability/error",
      "learning": "what was learned",
      "confidence": 0-1,
      "actionable": true/false,
      "action": "specific change to make"
    }
  ],
  "userPreferences": {
    "communication": "preferences about communication style",
    "codeStyle": "preferences about code",
    "workflow": "preferences about workflow"
  },
  "improvements": ["specific improvements to make"],
  "summary": "overall feedback analysis"
}`
      },
      {
        role: 'user',
        content: `Feedback:\n${JSON.stringify(unprocessed, null, 2)}`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  const result = JSON.parse(response.choices[0].message.content);

  // Store learnings
  result.learnings.forEach(l => {
    learnings.push({
      timestamp: new Date().toISOString(),
      ...l
    });
  });

  // Mark feedback as processed
  unprocessed.forEach(f => f.processed = true);

  return result;
}

/**
 * Apply learnings
 */
export function applyLearnings(context) {
  // Get relevant learnings for context
  const relevant = learnings.filter(l => {
    if (!l.actionable) return false;

    // Simple relevance matching
    const contextStr = JSON.stringify(context).toLowerCase();
    const learningStr = l.learning.toLowerCase();

    return contextStr.includes(l.category) ||
           learningStr.split(' ').some(word => contextStr.includes(word));
  });

  return {
    applicable: relevant.slice(0, 10),
    totalLearnings: learnings.length,
    categories: [...new Set(learnings.map(l => l.category))]
  };
}

// ============================================================================
// SELF-OPTIMIZATION
// ============================================================================

/**
 * Optimize system parameters
 */
export async function optimizeParameters(metrics, constraints = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Analyze metrics and suggest parameter optimizations.
Return JSON:
{
  "currentState": "assessment of current performance",
  "optimizations": [
    {
      "parameter": "what to change",
      "currentValue": "...",
      "suggestedValue": "...",
      "expectedImprovement": "...",
      "risk": "low/medium/high"
    }
  ],
  "tradeoffs": ["tradeoffs to consider"],
  "implementation": "how to implement changes",
  "monitoringPlan": "how to measure success"
}`
      },
      {
        role: 'user',
        content: `Metrics: ${JSON.stringify(metrics)}\nConstraints: ${JSON.stringify(constraints)}`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  const result = JSON.parse(response.choices[0].message.content);

  optimizationHistory.push({
    timestamp: new Date().toISOString(),
    metrics,
    suggestions: result.optimizations
  });

  return result;
}

/**
 * A/B test strategies
 */
export function createABTest(name, variants) {
  return {
    name,
    variants,
    assignment: () => {
      const random = Math.random();
      const threshold = 1 / variants.length;
      for (let i = 0; i < variants.length; i++) {
        if (random < threshold * (i + 1)) {
          return variants[i];
        }
      }
      return variants[0];
    },
    results: {},
    recordResult: function(variant, success, value = null) {
      if (!this.results[variant]) {
        this.results[variant] = { successes: 0, failures: 0, values: [] };
      }
      if (success) {
        this.results[variant].successes++;
      } else {
        this.results[variant].failures++;
      }
      if (value !== null) {
        this.results[variant].values.push(value);
      }
    },
    analyze: function() {
      const analysis = {};
      for (const [variant, data] of Object.entries(this.results)) {
        const total = data.successes + data.failures;
        analysis[variant] = {
          successRate: total > 0 ? data.successes / total : 0,
          sampleSize: total,
          avgValue: data.values.length > 0
            ? data.values.reduce((a, b) => a + b, 0) / data.values.length
            : null
        };
      }
      return analysis;
    }
  };
}

// ============================================================================
// CAPABILITY ASSESSMENT
// ============================================================================

/**
 * Assess current capabilities
 */
export async function assessCapabilities(services = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Assess AI system capabilities and identify gaps.
Return JSON:
{
  "capabilities": {
    "reasoning": {"level": 1-10, "strengths": [...], "weaknesses": [...]},
    "knowledge": {"level": 1-10, "domains": [...], "gaps": [...]},
    "execution": {"level": 1-10, "reliable": [...], "unreliable": [...]},
    "learning": {"level": 1-10, "adaptive": true/false, "areas": [...]}
  },
  "overallScore": 0-100,
  "topStrengths": ["strength 1", "strength 2"],
  "criticalGaps": ["gap 1", "gap 2"],
  "improvementPriorities": [
    {"area": "...", "impact": "high/medium/low", "effort": "high/medium/low"}
  ],
  "recommendations": ["recommendation 1"]
}`
      },
      {
        role: 'user',
        content: `Services available: ${JSON.stringify(Object.keys(services))}
Performance: ${JSON.stringify(getPerformanceStats())}
Learnings: ${learnings.length} items
Errors: ${errorLog.length} logged`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Identify capability gaps
 */
export async function identifyGaps(targetCapabilities, currentCapabilities) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Identify gaps between target and current capabilities.
Return JSON:
{
  "gaps": [
    {
      "capability": "what's missing",
      "severity": "critical/major/minor",
      "currentLevel": 0-10,
      "targetLevel": 0-10,
      "bridgingActions": ["action 1", "action 2"]
    }
  ],
  "achievable": ["capabilities within reach"],
  "requiresNewTools": ["capabilities needing new tools"],
  "prioritizedRoadmap": [
    {"milestone": "...", "capabilities": [...], "effort": "..."}
  ]
}`
      },
      {
        role: 'user',
        content: `Target: ${JSON.stringify(targetCapabilities)}\nCurrent: ${JSON.stringify(currentCapabilities)}`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// KNOWLEDGE SYNTHESIS
// ============================================================================

/**
 * Synthesize new knowledge from experience
 */
export async function synthesizeKnowledge(experiences, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Synthesize insights and patterns from experiences.
Return JSON:
{
  "insights": [
    {
      "type": "pattern/principle/heuristic/fact",
      "content": "the insight",
      "confidence": 0-1,
      "evidence": ["supporting experiences"],
      "applicability": "when this applies"
    }
  ],
  "principles": ["general principles derived"],
  "heuristics": ["rules of thumb discovered"],
  "contradictions": ["contradictory findings"],
  "hypotheses": ["hypotheses to test"]
}`
      },
      {
        role: 'user',
        content: `Experiences:\n${JSON.stringify(experiences, null, 2)}`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2500
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Consolidate and compress learnings
 */
export async function consolidateLearnings(options = {}) {
  if (!openai) throw new Error('OpenAI required');

  if (learnings.length < 10) {
    return { message: 'Not enough learnings to consolidate', count: learnings.length };
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Consolidate and summarize learnings into actionable principles.
Return JSON:
{
  "consolidatedPrinciples": [
    {
      "principle": "the principle",
      "supportingLearnings": [indices],
      "confidence": 0-1,
      "actionItems": ["specific actions"]
    }
  ],
  "deprecated": [indices to remove as redundant],
  "refined": [
    {"original": index, "refined": "improved version"}
  ],
  "summary": "meta-summary of all learnings"
}`
      },
      {
        role: 'user',
        content: `Learnings:\n${JSON.stringify(learnings, null, 2)}`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2500
  });

  const result = JSON.parse(response.choices[0].message.content);

  // Add consolidated principles as new high-confidence learnings
  result.consolidatedPrinciples.forEach(p => {
    learnings.push({
      timestamp: new Date().toISOString(),
      category: 'consolidated_principle',
      learning: p.principle,
      confidence: p.confidence,
      actionable: true,
      action: p.actionItems.join('; ')
    });
  });

  return result;
}

// ============================================================================
// GOAL TRACKING
// ============================================================================

const goals = [];

/**
 * Set improvement goal
 */
export function setGoal(goal) {
  const entry = {
    id: goals.length + 1,
    createdAt: new Date().toISOString(),
    status: 'active',
    progress: 0,
    ...goal
  };

  goals.push(entry);
  return entry;
}

/**
 * Update goal progress
 */
export function updateGoalProgress(goalId, progress, notes = '') {
  const goal = goals.find(g => g.id === goalId);
  if (!goal) return { error: 'Goal not found' };

  goal.progress = progress;
  goal.lastUpdated = new Date().toISOString();
  if (notes) goal.notes = (goal.notes || '') + '\n' + notes;

  if (progress >= 100) {
    goal.status = 'completed';
    goal.completedAt = new Date().toISOString();
  }

  return goal;
}

/**
 * Review goal progress
 */
export async function reviewGoals(options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const activeGoals = goals.filter(g => g.status === 'active');

  if (activeGoals.length === 0) {
    return { message: 'No active goals', goals: [] };
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Review goal progress and provide recommendations.
Return JSON:
{
  "goalReviews": [
    {
      "goalId": number,
      "status": "on_track/at_risk/behind/blocked",
      "assessment": "assessment of progress",
      "recommendations": ["recommendation"],
      "nextSteps": ["next step"]
    }
  ],
  "overallHealth": 0-100,
  "priorityAdjustments": ["suggested reprioritization"],
  "newGoalsSuggested": ["potential new goals based on progress"]
}`
      },
      {
        role: 'user',
        content: `Goals:\n${JSON.stringify(activeGoals, null, 2)}
Performance: ${JSON.stringify(getPerformanceStats())}`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    performanceTracking: true,
    errorAnalysis: !!openai,
    feedbackLearning: !!openai,
    selfOptimization: !!openai,
    capabilityAssessment: !!openai,
    knowledgeSynthesis: !!openai,
    goalTracking: true,
    stats: {
      performanceEntries: performanceLog.length,
      errors: errorLog.length,
      feedbackItems: feedbackLog.length,
      learnings: learnings.length,
      activeGoals: goals.filter(g => g.status === 'active').length
    },
    capabilities: [
      'performance_logging', 'performance_stats',
      'error_logging', 'error_analysis', 'error_fixing',
      'feedback_recording', 'feedback_learning', 'learning_application',
      'parameter_optimization', 'ab_testing',
      'capability_assessment', 'gap_identification',
      'knowledge_synthesis', 'learning_consolidation',
      'goal_setting', 'goal_tracking', 'goal_review'
    ],
    ready: true
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Performance
  logPerformance, getPerformanceStats,
  // Errors
  logError, analyzeErrors, suggestErrorFix,
  // Feedback
  recordFeedback, learnFromFeedback, applyLearnings,
  // Optimization
  optimizeParameters, createABTest,
  // Capabilities
  assessCapabilities, identifyGaps,
  // Knowledge
  synthesizeKnowledge, consolidateLearnings,
  // Goals
  setGoal, updateGoalProgress, reviewGoals
};
