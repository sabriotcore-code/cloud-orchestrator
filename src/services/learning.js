// ============================================================================
// ADAPTIVE LEARNING SERVICE
// Meta-learning, lifelong learning, transfer learning, human-in-the-loop
// ============================================================================

import OpenAI from 'openai';
import { pineconeUpsert, pineconeQuery } from './vector-db.js';
import { cacheSet, cacheGet } from './vector-db.js';
import mem0Service from './mem0.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Learning state - persists patterns and adaptations
const learningState = {
  patterns: new Map(),           // Learned patterns
  feedback: [],                  // User feedback history
  preferences: new Map(),        // User preferences
  domainKnowledge: new Map(),    // Domain-specific knowledge
  performanceHistory: [],        // Track performance over time
  activeExperiments: new Map()   // A/B testing
};

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    metaLearning: true,
    lifelongLearning: true,
    transferLearning: true,
    humanInTheLoop: true,
    patternsLearned: learningState.patterns.size,
    feedbackCount: learningState.feedback.length,
    ready: !!openai
  };
}

// ============================================================================
// META-LEARNING (Learning to Learn)
// ============================================================================

/**
 * Analyze a new task and select optimal learning approach
 * @param {string} task - Task description
 * @param {object} examples - Few-shot examples if available
 */
export async function analyzeTaskForLearning(task, examples = []) {
  if (!openai) throw new Error('OpenAI API not configured');

  // Check if we've seen similar tasks
  const similarPatterns = await findSimilarPatterns(task);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a meta-learning system. Analyze tasks and recommend optimal learning strategies.

Consider:
- Task complexity
- Available examples
- Similar past tasks
- Required knowledge domains
- Optimal few-shot approach`
      },
      {
        role: 'user',
        content: `Analyze this task for optimal learning:

TASK: ${task}

EXAMPLES PROVIDED: ${examples.length}
${examples.length > 0 ? examples.map((e, i) => `Example ${i + 1}: ${JSON.stringify(e)}`).join('\n') : 'None'}

SIMILAR PAST PATTERNS: ${similarPatterns.length}
${similarPatterns.map(p => `- ${p.description}`).join('\n') || 'None found'}

Recommend:
1. Learning strategy (zero-shot, few-shot, chain-of-thought, etc.)
2. Required examples count
3. Knowledge domains to activate
4. Confidence in approach
5. Fallback strategies`
      }
    ]
  });

  return {
    task,
    examplesProvided: examples.length,
    similarPatternsFound: similarPatterns.length,
    recommendation: response.choices[0].message.content
  };
}

/**
 * Learn a new pattern from successful task completion
 */
export async function learnPattern(taskType, input, output, method) {
  const patternId = `pattern_${Date.now()}`;

  const pattern = {
    id: patternId,
    taskType,
    input: input.substring(0, 500),
    output: output.substring(0, 500),
    method,
    createdAt: new Date().toISOString(),
    successCount: 1,
    failCount: 0
  };

  learningState.patterns.set(patternId, pattern);

  // Generate embedding for similarity search
  if (openai) {
    const embedding = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: `${taskType}: ${input}`
    });

    await pineconeUpsert('learning-patterns', [{
      id: patternId,
      values: embedding.data[0].embedding,
      metadata: pattern
    }]);
  }

  return { success: true, patternId, pattern };
}

/**
 * Find similar patterns from past learning
 */
async function findSimilarPatterns(task, topK = 5) {
  if (!openai) return [];

  try {
    const embedding = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: task
    });

    const results = await pineconeQuery('learning-patterns', embedding.data[0].embedding, topK);

    return results.map(r => ({
      id: r.id,
      score: r.score,
      description: r.metadata?.input || '',
      method: r.metadata?.method
    }));
  } catch {
    return [];
  }
}

/**
 * Update pattern based on feedback
 */
export function updatePattern(patternId, success) {
  const pattern = learningState.patterns.get(patternId);
  if (pattern) {
    if (success) {
      pattern.successCount++;
    } else {
      pattern.failCount++;
    }
    pattern.successRate = pattern.successCount / (pattern.successCount + pattern.failCount);
  }
  return pattern;
}

// ============================================================================
// LIFELONG LEARNING
// ============================================================================

/**
 * Store knowledge that persists across sessions
 * Uses Mem0 for long-term storage
 */
export async function storeKnowledge(category, knowledge, metadata = {}) {
  const knowledgeEntry = {
    category,
    content: knowledge,
    metadata,
    timestamp: new Date().toISOString()
  };

  // Store in local state
  if (!learningState.domainKnowledge.has(category)) {
    learningState.domainKnowledge.set(category, []);
  }
  learningState.domainKnowledge.get(category).push(knowledgeEntry);

  // Store in Mem0 for persistence
  try {
    await mem0Service.addMemory(
      `[${category}] ${knowledge}`,
      'system',
      { type: 'knowledge', category, ...metadata }
    );
  } catch (e) {
    console.log('[Learning] Mem0 storage failed:', e.message);
  }

  // Cache for quick access
  await cacheSet(`knowledge:${category}:latest`, knowledgeEntry, 86400);

  return { success: true, category, stored: true };
}

/**
 * Retrieve knowledge by category
 */
export async function retrieveKnowledge(category, query = '') {
  const results = [];

  // Check local state
  const localKnowledge = learningState.domainKnowledge.get(category) || [];
  results.push(...localKnowledge);

  // Check Mem0
  try {
    const mem0Results = await mem0Service.searchMemories(
      query || category,
      'system',
      10
    );
    results.push(...mem0Results.map(m => ({
      content: m.memory,
      source: 'mem0',
      score: m.score
    })));
  } catch (e) {
    console.log('[Learning] Mem0 retrieval failed:', e.message);
  }

  return {
    category,
    query,
    results,
    count: results.length
  };
}

/**
 * Consolidate and summarize learned knowledge
 */
export async function consolidateKnowledge(category) {
  if (!openai) throw new Error('OpenAI API not configured');

  const knowledge = await retrieveKnowledge(category);

  if (knowledge.results.length === 0) {
    return { category, message: 'No knowledge to consolidate' };
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'Consolidate and summarize knowledge entries, removing redundancy while preserving key insights.'
      },
      {
        role: 'user',
        content: `Consolidate this knowledge about "${category}":

${knowledge.results.map(k => k.content || k).join('\n\n')}

Create a structured summary that:
1. Identifies main themes
2. Removes redundancy
3. Highlights key insights
4. Notes any contradictions
5. Suggests knowledge gaps`
      }
    ]
  });

  return {
    category,
    originalCount: knowledge.results.length,
    consolidatedSummary: response.choices[0].message.content
  };
}

// ============================================================================
// TRANSFER LEARNING
// ============================================================================

/**
 * Transfer knowledge from one domain to another
 */
export async function transferKnowledge(sourceDomain, targetDomain, context = '') {
  if (!openai) throw new Error('OpenAI API not configured');

  // Get knowledge from source domain
  const sourceKnowledge = await retrieveKnowledge(sourceDomain);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are an expert at transferring knowledge between domains.
Identify concepts that transfer and adapt terminology appropriately.`
      },
      {
        role: 'user',
        content: `Transfer knowledge from "${sourceDomain}" to "${targetDomain}":

SOURCE KNOWLEDGE:
${sourceKnowledge.results.map(k => k.content || k).join('\n')}

${context ? `CONTEXT: ${context}` : ''}

Identify:
1. Directly transferable concepts
2. Concepts needing adaptation
3. Domain-specific terminology mapping
4. Limitations of the transfer
5. New insights from the transfer`
      }
    ]
  });

  return {
    sourceDomain,
    targetDomain,
    transfer: response.choices[0].message.content,
    sourceKnowledgeCount: sourceKnowledge.results.length
  };
}

/**
 * Apply learned skills to new problem
 */
export async function applySkills(problem, availableSkills = []) {
  if (!openai) throw new Error('OpenAI API not configured');

  // Get all learned patterns
  const patterns = Array.from(learningState.patterns.values())
    .filter(p => p.successRate > 0.5)
    .slice(0, 10);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: `Apply learned skills to solve this problem:

PROBLEM: ${problem}

AVAILABLE SKILLS:
${availableSkills.map(s => `- ${s}`).join('\n') || 'None specified'}

LEARNED PATTERNS (high success rate):
${patterns.map(p => `- ${p.taskType}: ${p.method} (${Math.round(p.successRate * 100)}% success)`).join('\n') || 'None'}

Recommend:
1. Which skills/patterns to apply
2. How to combine them
3. Expected approach
4. Potential challenges`
      }
    ]
  });

  return {
    problem,
    recommendation: response.choices[0].message.content,
    patternsConsidered: patterns.length,
    skillsAvailable: availableSkills.length
  };
}

// ============================================================================
// HUMAN-IN-THE-LOOP
// ============================================================================

/**
 * Record user feedback for learning
 */
export async function recordFeedback(responseId, feedback, context = {}) {
  const feedbackEntry = {
    id: `feedback_${Date.now()}`,
    responseId,
    feedback,
    context,
    timestamp: new Date().toISOString()
  };

  learningState.feedback.push(feedbackEntry);

  // Keep only last 1000 feedback entries
  if (learningState.feedback.length > 1000) {
    learningState.feedback.shift();
  }

  // Analyze feedback for pattern
  if (openai && learningState.feedback.length > 10) {
    await analyzeFeedbackPatterns();
  }

  return { success: true, feedbackId: feedbackEntry.id };
}

/**
 * Analyze feedback patterns to improve
 */
async function analyzeFeedbackPatterns() {
  const recentFeedback = learningState.feedback.slice(-50);

  const positiveFeedback = recentFeedback.filter(f =>
    f.feedback.toLowerCase().includes('good') ||
    f.feedback.toLowerCase().includes('correct') ||
    f.feedback.toLowerCase().includes('helpful')
  );

  const negativeFeedback = recentFeedback.filter(f =>
    f.feedback.toLowerCase().includes('wrong') ||
    f.feedback.toLowerCase().includes('bad') ||
    f.feedback.toLowerCase().includes('incorrect')
  );

  return {
    total: recentFeedback.length,
    positive: positiveFeedback.length,
    negative: negativeFeedback.length,
    positiveRate: positiveFeedback.length / recentFeedback.length
  };
}

/**
 * Learn user preferences from interactions
 */
export function learnPreference(userId, preferenceType, value) {
  const key = `${userId}:${preferenceType}`;

  if (!learningState.preferences.has(key)) {
    learningState.preferences.set(key, []);
  }

  learningState.preferences.get(key).push({
    value,
    timestamp: new Date().toISOString()
  });

  // Keep only last 100 preference observations
  const prefs = learningState.preferences.get(key);
  if (prefs.length > 100) {
    prefs.shift();
  }

  return { success: true, preference: preferenceType, recorded: true };
}

/**
 * Get inferred user preferences
 */
export function getUserPreferences(userId) {
  const preferences = {};

  for (const [key, values] of learningState.preferences) {
    if (key.startsWith(`${userId}:`)) {
      const prefType = key.split(':')[1];
      // Get most common value
      const valueCounts = {};
      for (const v of values) {
        valueCounts[v.value] = (valueCounts[v.value] || 0) + 1;
      }
      const mostCommon = Object.entries(valueCounts)
        .sort((a, b) => b[1] - a[1])[0];

      preferences[prefType] = {
        value: mostCommon?.[0],
        confidence: mostCommon ? mostCommon[1] / values.length : 0,
        observations: values.length
      };
    }
  }

  return { userId, preferences };
}

/**
 * Request human clarification
 */
export function requestClarification(question, options = [], context = '') {
  return {
    type: 'clarification_request',
    question,
    options: options.length > 0 ? options : null,
    context,
    timestamp: new Date().toISOString()
  };
}

/**
 * Escalate to human for complex decision
 */
export function escalateToHuman(reason, decision, options, context = '') {
  return {
    type: 'escalation',
    reason,
    decision,
    options,
    context,
    confidence: 'low',
    timestamp: new Date().toISOString(),
    message: 'This decision requires human judgment'
  };
}

// ============================================================================
// PERFORMANCE TRACKING
// ============================================================================

/**
 * Track performance metrics
 */
export function trackPerformance(taskType, metrics) {
  learningState.performanceHistory.push({
    taskType,
    metrics,
    timestamp: new Date().toISOString()
  });

  // Keep only last 1000 entries
  if (learningState.performanceHistory.length > 1000) {
    learningState.performanceHistory.shift();
  }

  return { success: true };
}

/**
 * Get performance summary
 */
export function getPerformanceSummary(taskType = null) {
  let history = learningState.performanceHistory;

  if (taskType) {
    history = history.filter(h => h.taskType === taskType);
  }

  if (history.length === 0) {
    return { message: 'No performance data' };
  }

  // Calculate averages for numeric metrics
  const metrics = {};
  for (const entry of history) {
    for (const [key, value] of Object.entries(entry.metrics)) {
      if (typeof value === 'number') {
        if (!metrics[key]) metrics[key] = [];
        metrics[key].push(value);
      }
    }
  }

  const summary = {};
  for (const [key, values] of Object.entries(metrics)) {
    summary[key] = {
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      samples: values.length
    };
  }

  return {
    taskType,
    totalEntries: history.length,
    summary
  };
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

/**
 * Get learning state summary
 */
export function getLearningState() {
  return {
    patterns: learningState.patterns.size,
    feedback: learningState.feedback.length,
    preferences: learningState.preferences.size,
    domainKnowledge: learningState.domainKnowledge.size,
    performanceHistory: learningState.performanceHistory.length,
    activeExperiments: learningState.activeExperiments.size
  };
}

/**
 * Export learning data
 */
export function exportLearningData() {
  return {
    patterns: Array.from(learningState.patterns.entries()),
    feedback: learningState.feedback,
    preferences: Array.from(learningState.preferences.entries()),
    domainKnowledge: Array.from(learningState.domainKnowledge.entries()),
    performanceHistory: learningState.performanceHistory.slice(-100),
    exportedAt: new Date().toISOString()
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Meta-learning
  analyzeTaskForLearning,
  learnPattern,
  updatePattern,
  // Lifelong learning
  storeKnowledge,
  retrieveKnowledge,
  consolidateKnowledge,
  // Transfer learning
  transferKnowledge,
  applySkills,
  // Human-in-the-loop
  recordFeedback,
  learnPreference,
  getUserPreferences,
  requestClarification,
  escalateToHuman,
  // Performance
  trackPerformance,
  getPerformanceSummary,
  // State
  getLearningState,
  exportLearningData
};
