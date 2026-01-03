/**
 * REFLECTION & ERROR LEARNING SYSTEM
 *
 * Analyzes task outcomes, learns from mistakes, predicts errors before they happen.
 * Stores structured lessons: (context, action, outcome, insight)
 */

import * as db from '../db/index.js';

// ============================================================================
// SCHEMA SETUP
// ============================================================================

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS task_reflections (
        id SERIAL PRIMARY KEY,
        task_id VARCHAR(100),
        task_type VARCHAR(50),
        context TEXT,
        action TEXT,
        outcome VARCHAR(20), -- success, failure, partial
        error_message TEXT,
        insight TEXT,
        tags TEXT[], -- categorization tags
        confidence FLOAT DEFAULT 0.5,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS error_patterns (
        id SERIAL PRIMARY KEY,
        pattern_name VARCHAR(100),
        error_signature TEXT, -- regex or keyword pattern
        context_keywords TEXT[],
        frequency INTEGER DEFAULT 1,
        prevention_strategy TEXT,
        success_rate FLOAT DEFAULT 0,
        last_seen TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS learned_lessons (
        id SERIAL PRIMARY KEY,
        lesson_type VARCHAR(50), -- code, api, user_pref, tool_usage
        trigger_context TEXT,
        lesson TEXT,
        confidence FLOAT DEFAULT 0.5,
        times_applied INTEGER DEFAULT 0,
        success_when_applied FLOAT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Create indexes for fast lookups
    await db.query(`CREATE INDEX IF NOT EXISTS idx_reflections_task_type ON task_reflections(task_type)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_reflections_outcome ON task_reflections(outcome)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_error_patterns_frequency ON error_patterns(frequency DESC)`);

    schemaReady = true;
    console.log('[Reflection] Schema ready');
  } catch (err) {
    console.error('[Reflection] Schema setup error:', err.message);
  }
}

// ============================================================================
// TASK REFLECTION
// ============================================================================

/**
 * Record a task outcome for learning
 */
export async function recordTaskOutcome(taskData) {
  await ensureSchema();

  const {
    taskId,
    taskType,
    context,
    action,
    outcome, // 'success', 'failure', 'partial'
    errorMessage,
    tags = []
  } = taskData;

  // Generate insight from outcome
  const insight = await generateInsight(taskData);

  const result = await db.query(`
    INSERT INTO task_reflections
    (task_id, task_type, context, action, outcome, error_message, insight, tags)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [taskId, taskType, context, action, outcome, errorMessage, insight, tags]);

  // If failure, analyze for patterns
  if (outcome === 'failure') {
    await analyzeErrorPattern(taskData);
  }

  // Extract and store lessons
  if (insight) {
    await storeLessonFromReflection(taskType, context, insight, outcome === 'success');
  }

  return result.rows[0];
}

/**
 * Generate insight from task outcome
 */
async function generateInsight(taskData) {
  const { taskType, action, outcome, errorMessage, context } = taskData;

  if (outcome === 'success') {
    return `Successfully completed ${taskType}: ${action.substring(0, 100)}`;
  }

  if (outcome === 'failure' && errorMessage) {
    // Extract key learning from error
    const patterns = [
      { regex: /not found/i, insight: 'Resource not found - verify path/ID before action' },
      { regex: /permission|denied|unauthorized/i, insight: 'Permission issue - check access rights' },
      { regex: /timeout/i, insight: 'Operation timed out - consider retry or chunking' },
      { regex: /rate limit/i, insight: 'Rate limited - implement backoff strategy' },
      { regex: /syntax|parse|invalid/i, insight: 'Syntax/format error - validate input format' },
      { regex: /connection|network/i, insight: 'Network issue - verify connectivity and retry' },
    ];

    for (const p of patterns) {
      if (p.regex.test(errorMessage)) {
        return p.insight;
      }
    }

    return `Error in ${taskType}: ${errorMessage.substring(0, 200)}`;
  }

  return `Partial completion of ${taskType}`;
}

// ============================================================================
// ERROR PATTERN ANALYSIS
// ============================================================================

/**
 * Analyze and store error patterns for prediction
 */
async function analyzeErrorPattern(taskData) {
  const { taskType, errorMessage, context } = taskData;

  if (!errorMessage) return;

  // Create error signature (simplified pattern)
  const signature = errorMessage
    .replace(/[0-9]+/g, 'N')
    .replace(/['"][^'"]*['"]/g, '"X"')
    .substring(0, 200);

  // Extract context keywords
  const keywords = extractKeywords(context || '');

  // Check if pattern exists
  const existing = await db.query(`
    SELECT * FROM error_patterns
    WHERE error_signature = $1 AND pattern_name = $2
  `, [signature, taskType]);

  if (existing.rows.length > 0) {
    // Update frequency
    await db.query(`
      UPDATE error_patterns
      SET frequency = frequency + 1, last_seen = NOW()
      WHERE id = $1
    `, [existing.rows[0].id]);
  } else {
    // Create new pattern
    const prevention = generatePreventionStrategy(signature, taskType);

    await db.query(`
      INSERT INTO error_patterns
      (pattern_name, error_signature, context_keywords, prevention_strategy)
      VALUES ($1, $2, $3, $4)
    `, [taskType, signature, keywords, prevention]);
  }
}

/**
 * Extract keywords from context
 */
function extractKeywords(text) {
  const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  const stopWords = new Set(['this', 'that', 'with', 'from', 'have', 'been', 'were', 'they']);
  const filtered = words.filter(w => !stopWords.has(w));

  // Get unique words, sorted by frequency
  const freq = {};
  filtered.forEach(w => freq[w] = (freq[w] || 0) + 1);

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

/**
 * Generate prevention strategy for error pattern
 */
function generatePreventionStrategy(signature, taskType) {
  const strategies = {
    'not found': 'Verify resource exists before action. Use try-catch with fallback.',
    'permission': 'Check permissions upfront. Request elevated access if needed.',
    'timeout': 'Implement retry with exponential backoff. Consider chunking large operations.',
    'rate limit': 'Add delays between requests. Implement queue with rate limiting.',
    'syntax': 'Validate input format. Use schema validation before processing.',
    'connection': 'Implement connection retry. Check network status before operations.',
  };

  for (const [key, strategy] of Object.entries(strategies)) {
    if (signature.toLowerCase().includes(key)) {
      return strategy;
    }
  }

  return `Review ${taskType} implementation. Add error handling and validation.`;
}

// ============================================================================
// LESSON LEARNING
// ============================================================================

/**
 * Store a lesson learned from reflection
 */
async function storeLessonFromReflection(taskType, context, insight, wasSuccess) {
  await ensureSchema();

  // Check for similar existing lesson
  const existing = await db.query(`
    SELECT * FROM learned_lessons
    WHERE lesson_type = $1 AND lesson LIKE $2
    LIMIT 1
  `, [taskType, `%${insight.substring(0, 50)}%`]);

  if (existing.rows.length > 0) {
    // Update existing lesson confidence
    const newConfidence = wasSuccess
      ? Math.min(existing.rows[0].confidence + 0.1, 1.0)
      : Math.max(existing.rows[0].confidence - 0.05, 0.1);

    await db.query(`
      UPDATE learned_lessons
      SET confidence = $1, times_applied = times_applied + 1, updated_at = NOW()
      WHERE id = $2
    `, [newConfidence, existing.rows[0].id]);
  } else {
    // Create new lesson
    await db.query(`
      INSERT INTO learned_lessons (lesson_type, trigger_context, lesson, confidence)
      VALUES ($1, $2, $3, $4)
    `, [taskType, context?.substring(0, 500), insight, wasSuccess ? 0.6 : 0.4]);
  }
}

// ============================================================================
// ERROR PREDICTION
// ============================================================================

/**
 * Predict potential errors before task execution
 */
export async function predictErrors(taskType, context) {
  await ensureSchema();

  const predictions = [];

  // Get relevant error patterns
  const patterns = await db.query(`
    SELECT * FROM error_patterns
    WHERE pattern_name = $1 AND frequency >= 2
    ORDER BY frequency DESC
    LIMIT 5
  `, [taskType]);

  for (const pattern of patterns.rows) {
    // Check if context matches pattern keywords
    const contextLower = (context || '').toLowerCase();
    const matchingKeywords = pattern.context_keywords?.filter(kw =>
      contextLower.includes(kw)
    ) || [];

    if (matchingKeywords.length > 0 || pattern.frequency >= 5) {
      predictions.push({
        risk: pattern.frequency >= 5 ? 'high' : 'medium',
        pattern: pattern.error_signature,
        prevention: pattern.prevention_strategy,
        frequency: pattern.frequency,
        matchedKeywords: matchingKeywords
      });
    }
  }

  return predictions;
}

/**
 * Get applicable lessons for a task
 */
export async function getApplicableLessons(taskType, context) {
  await ensureSchema();

  const lessons = await db.query(`
    SELECT * FROM learned_lessons
    WHERE lesson_type = $1 AND confidence >= 0.5
    ORDER BY confidence DESC, times_applied DESC
    LIMIT 5
  `, [taskType]);

  return lessons.rows.map(l => ({
    lesson: l.lesson,
    confidence: l.confidence,
    timesApplied: l.times_applied
  }));
}

// ============================================================================
// STATISTICS & ANALYSIS
// ============================================================================

/**
 * Get reflection statistics
 */
export async function getReflectionStats() {
  await ensureSchema();

  const stats = await db.query(`
    SELECT
      COUNT(*) as total_reflections,
      COUNT(CASE WHEN outcome = 'success' THEN 1 END) as successes,
      COUNT(CASE WHEN outcome = 'failure' THEN 1 END) as failures,
      COUNT(DISTINCT task_type) as task_types
    FROM task_reflections
  `);

  const patterns = await db.query(`
    SELECT COUNT(*) as total_patterns, SUM(frequency) as total_errors
    FROM error_patterns
  `);

  const lessons = await db.query(`
    SELECT COUNT(*) as total_lessons, AVG(confidence) as avg_confidence
    FROM learned_lessons
  `);

  const topErrors = await db.query(`
    SELECT pattern_name, error_signature, frequency, prevention_strategy
    FROM error_patterns
    ORDER BY frequency DESC
    LIMIT 5
  `);

  return {
    reflections: stats.rows[0],
    patterns: patterns.rows[0],
    lessons: lessons.rows[0],
    topErrors: topErrors.rows,
    successRate: stats.rows[0].total_reflections > 0
      ? (stats.rows[0].successes / stats.rows[0].total_reflections * 100).toFixed(1) + '%'
      : 'N/A'
  };
}

/**
 * Get improvement suggestions based on error patterns
 */
export async function getImprovementSuggestions() {
  await ensureSchema();

  const suggestions = [];

  // High frequency errors
  const highFreqErrors = await db.query(`
    SELECT * FROM error_patterns
    WHERE frequency >= 3
    ORDER BY frequency DESC
    LIMIT 10
  `);

  for (const error of highFreqErrors.rows) {
    suggestions.push({
      priority: error.frequency >= 5 ? 'high' : 'medium',
      area: error.pattern_name,
      issue: `Error occurs ${error.frequency} times: ${error.error_signature.substring(0, 100)}`,
      suggestion: error.prevention_strategy
    });
  }

  // Low confidence lessons that need reinforcement
  const weakLessons = await db.query(`
    SELECT * FROM learned_lessons
    WHERE confidence < 0.5 AND times_applied >= 2
    ORDER BY confidence ASC
    LIMIT 5
  `);

  for (const lesson of weakLessons.rows) {
    suggestions.push({
      priority: 'low',
      area: lesson.lesson_type,
      issue: `Lesson has low confidence (${(lesson.confidence * 100).toFixed(0)}%)`,
      suggestion: `Review and validate: ${lesson.lesson}`
    });
  }

  return suggestions;
}

export default {
  recordTaskOutcome,
  predictErrors,
  getApplicableLessons,
  getReflectionStats,
  getImprovementSuggestions
};
