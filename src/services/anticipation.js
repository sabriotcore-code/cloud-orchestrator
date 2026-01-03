/**
 * PROACTIVE ANTICIPATION ENGINE
 *
 * Predicts user needs before they ask:
 * - Pattern recognition from past interactions
 * - Next-action prediction
 * - Resource pre-fetching
 * - Context-aware suggestions
 * - Workflow analysis
 */

import * as db from '../db/index.js';

// ============================================================================
// SCHEMA SETUP
// ============================================================================

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;

  try {
    // User action patterns
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_patterns (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100) NOT NULL,
        pattern_type VARCHAR(50), -- workflow, time_based, context_triggered
        trigger_context TEXT,
        typical_action TEXT,
        frequency INTEGER DEFAULT 1,
        confidence FLOAT DEFAULT 0.5,
        last_triggered TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Action sequences (what follows what)
    await db.query(`
      CREATE TABLE IF NOT EXISTS action_sequences (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100),
        action_a VARCHAR(200), -- first action
        action_b VARCHAR(200), -- following action
        sequence_count INTEGER DEFAULT 1,
        avg_gap_seconds INTEGER DEFAULT 60,
        last_seen TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, action_a, action_b)
      )
    `);

    // Predicted needs (for pre-fetching)
    await db.query(`
      CREATE TABLE IF NOT EXISTS predicted_needs (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100),
        need_type VARCHAR(50), -- file, data, api_call, information
        resource_identifier TEXT,
        probability FLOAT DEFAULT 0.5,
        context_trigger TEXT,
        prefetched_at TIMESTAMPTZ,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Time-based triggers
    await db.query(`
      CREATE TABLE IF NOT EXISTS time_triggers (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100),
        day_of_week INTEGER, -- 0=Sunday, 6=Saturday
        hour_of_day INTEGER, -- 0-23
        typical_action TEXT,
        frequency INTEGER DEFAULT 1,
        last_triggered TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Suggestions shown
    await db.query(`
      CREATE TABLE IF NOT EXISTS suggestions_log (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100),
        suggestion_type VARCHAR(50),
        suggestion_text TEXT,
        context TEXT,
        accepted BOOLEAN DEFAULT FALSE,
        shown_at TIMESTAMPTZ DEFAULT NOW(),
        acted_at TIMESTAMPTZ
      )
    `);

    // Indexes
    await db.query(`CREATE INDEX IF NOT EXISTS idx_patterns_user ON user_patterns(user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_sequences_user ON action_sequences(user_id, action_a)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_time_triggers_user ON time_triggers(user_id, day_of_week, hour_of_day)`);

    schemaReady = true;
    console.log('[Anticipation] Schema ready');
  } catch (err) {
    console.error('[Anticipation] Schema setup error:', err.message);
  }
}

// ============================================================================
// ACTION TRACKING
// ============================================================================

/**
 * Record a user action for pattern learning
 */
export async function recordAction(userId, action, context = null) {
  await ensureSchema();

  // Normalize action
  const normalizedAction = normalizeAction(action);

  // Get user's last action
  const lastAction = await db.getMemory(`last_action:${userId}`);

  if (lastAction) {
    // Record sequence
    await recordSequence(userId, lastAction.action, normalizedAction);
  }

  // Store this as last action
  await db.setMemory(`last_action:${userId}`, {
    action: normalizedAction,
    context,
    timestamp: Date.now()
  }, 'anticipation');

  // Record time-based pattern
  const now = new Date();
  await recordTimeTrigger(userId, now.getDay(), now.getHours(), normalizedAction);

  // Update context patterns
  if (context) {
    await recordContextPattern(userId, context, normalizedAction);
  }

  return { recorded: true, action: normalizedAction };
}

/**
 * Normalize action for pattern matching
 */
function normalizeAction(action) {
  return action
    .toLowerCase()
    .replace(/[0-9]+/g, 'N')
    .replace(/["'][^"']*["']/g, '"X"')
    .substring(0, 200);
}

/**
 * Record action sequence
 */
async function recordSequence(userId, actionA, actionB) {
  await db.query(`
    INSERT INTO action_sequences (user_id, action_a, action_b, sequence_count, avg_gap_seconds)
    VALUES ($1, $2, $3, 1, 60)
    ON CONFLICT (user_id, action_a, action_b)
    DO UPDATE SET
      sequence_count = action_sequences.sequence_count + 1,
      last_seen = NOW()
  `, [userId, actionA, actionB]);
}

/**
 * Record time-based trigger
 */
async function recordTimeTrigger(userId, dayOfWeek, hourOfDay, action) {
  await db.query(`
    INSERT INTO time_triggers (user_id, day_of_week, hour_of_day, typical_action, frequency)
    VALUES ($1, $2, $3, $4, 1)
    ON CONFLICT (user_id, day_of_week, hour_of_day, typical_action)
    DO UPDATE SET
      frequency = time_triggers.frequency + 1,
      last_triggered = NOW()
  `, [userId, dayOfWeek, hourOfDay, action]);
}

/**
 * Record context-triggered pattern
 */
async function recordContextPattern(userId, context, action) {
  const contextKey = extractContextKey(context);

  // Check if pattern exists
  const existing = await db.query(`
    SELECT * FROM user_patterns
    WHERE user_id = $1 AND trigger_context = $2 AND typical_action = $3
    LIMIT 1
  `, [userId, contextKey, action]);

  if (existing.rows.length > 0) {
    await db.query(`
      UPDATE user_patterns
      SET frequency = frequency + 1,
          confidence = LEAST(confidence + 0.05, 0.95),
          last_triggered = NOW()
      WHERE id = $1
    `, [existing.rows[0].id]);
  } else {
    await db.query(`
      INSERT INTO user_patterns (user_id, pattern_type, trigger_context, typical_action)
      VALUES ($1, 'context_triggered', $2, $3)
    `, [userId, contextKey, action]);
  }
}

/**
 * Extract key from context for pattern matching
 */
function extractContextKey(context) {
  if (typeof context !== 'string') {
    context = JSON.stringify(context);
  }

  // Extract key elements
  const keywords = [];

  // File types
  const fileMatch = context.match(/\.(js|ts|py|json|md|html|css)(?:\b|$)/gi);
  if (fileMatch) keywords.push(...fileMatch.map(f => f.toLowerCase()));

  // Domains/projects
  const projectMatch = context.match(/rei-|cloud-|pinecone-|dashboard|api|orchestrator/gi);
  if (projectMatch) keywords.push(...projectMatch.map(p => p.toLowerCase()));

  // Actions
  const actionMatch = context.match(/edit|create|delete|deploy|commit|push|test|build/gi);
  if (actionMatch) keywords.push(...actionMatch.map(a => a.toLowerCase()));

  return keywords.slice(0, 5).join('_') || 'general';
}

// ============================================================================
// PREDICTION
// ============================================================================

/**
 * Predict next action based on current context
 */
export async function predictNextAction(userId, currentAction, context = null) {
  await ensureSchema();

  const predictions = [];

  // Get sequence-based predictions
  const sequences = await db.query(`
    SELECT action_b, sequence_count
    FROM action_sequences
    WHERE user_id = $1 AND action_a = $2
    ORDER BY sequence_count DESC
    LIMIT 5
  `, [userId, normalizeAction(currentAction)]);

  for (const seq of sequences.rows) {
    predictions.push({
      action: seq.action_b,
      source: 'sequence',
      confidence: Math.min(seq.sequence_count / 10, 0.9),
      reason: `You typically do this after ${currentAction}`
    });
  }

  // Get time-based predictions
  const now = new Date();
  const timePredictions = await db.query(`
    SELECT typical_action, frequency
    FROM time_triggers
    WHERE user_id = $1 AND day_of_week = $2 AND hour_of_day = $3
    ORDER BY frequency DESC
    LIMIT 3
  `, [userId, now.getDay(), now.getHours()]);

  for (const tp of timePredictions.rows) {
    predictions.push({
      action: tp.typical_action,
      source: 'time_pattern',
      confidence: Math.min(tp.frequency / 20, 0.8),
      reason: `You often do this at this time`
    });
  }

  // Get context-based predictions
  if (context) {
    const contextKey = extractContextKey(context);
    const contextPredictions = await db.query(`
      SELECT typical_action, confidence, frequency
      FROM user_patterns
      WHERE user_id = $1 AND trigger_context = $2
      ORDER BY confidence DESC, frequency DESC
      LIMIT 3
    `, [userId, contextKey]);

    for (const cp of contextPredictions.rows) {
      predictions.push({
        action: cp.typical_action,
        source: 'context',
        confidence: cp.confidence,
        reason: `Based on similar context`
      });
    }
  }

  // Deduplicate and sort by confidence
  const uniquePredictions = deduplicatePredictions(predictions);
  return uniquePredictions.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

/**
 * Deduplicate predictions
 */
function deduplicatePredictions(predictions) {
  const seen = new Map();

  for (const pred of predictions) {
    const key = pred.action;
    if (!seen.has(key) || seen.get(key).confidence < pred.confidence) {
      seen.set(key, pred);
    }
  }

  return [...seen.values()];
}

// ============================================================================
// PROACTIVE SUGGESTIONS
// ============================================================================

/**
 * Generate proactive suggestions
 */
export async function generateSuggestions(userId, context = {}) {
  await ensureSchema();

  const suggestions = [];
  const { currentAction, currentFile, currentProject, recentErrors } = context;

  // Action-based suggestions
  if (currentAction) {
    const nextActions = await predictNextAction(userId, currentAction, context);
    for (const pred of nextActions) {
      if (pred.confidence > 0.5) {
        suggestions.push({
          type: 'next_action',
          text: `Would you like to ${pred.action}?`,
          action: pred.action,
          confidence: pred.confidence,
          reason: pred.reason
        });
      }
    }
  }

  // Error-based suggestions
  if (recentErrors && recentErrors.length > 0) {
    suggestions.push({
      type: 'error_help',
      text: `I noticed some errors. Want me to help fix them?`,
      action: 'fix_errors',
      confidence: 0.8,
      reason: 'Recent errors detected'
    });
  }

  // Project-specific suggestions
  if (currentProject) {
    const projectSuggestions = await getProjectSuggestions(userId, currentProject);
    suggestions.push(...projectSuggestions);
  }

  // Time-based suggestions
  const timeSuggestions = await getTimeSuggestions(userId);
  suggestions.push(...timeSuggestions);

  // Log suggestions shown
  for (const sug of suggestions.slice(0, 5)) {
    await db.query(`
      INSERT INTO suggestions_log (user_id, suggestion_type, suggestion_text, context)
      VALUES ($1, $2, $3, $4)
    `, [userId, sug.type, sug.text, JSON.stringify(context).substring(0, 500)]);
  }

  return suggestions.slice(0, 5);
}

/**
 * Get project-specific suggestions
 */
async function getProjectSuggestions(userId, project) {
  const suggestions = [];

  const patterns = await db.query(`
    SELECT typical_action, confidence, frequency
    FROM user_patterns
    WHERE user_id = $1 AND trigger_context LIKE $2
    ORDER BY frequency DESC
    LIMIT 3
  `, [userId, `%${project}%`]);

  for (const p of patterns.rows) {
    if (p.confidence > 0.6) {
      suggestions.push({
        type: 'project_action',
        text: `For ${project}: ${p.typical_action}?`,
        action: p.typical_action,
        confidence: p.confidence,
        reason: `Common action for this project`
      });
    }
  }

  return suggestions;
}

/**
 * Get time-based suggestions
 */
async function getTimeSuggestions(userId) {
  const suggestions = [];
  const now = new Date();

  const triggers = await db.query(`
    SELECT typical_action, frequency
    FROM time_triggers
    WHERE user_id = $1 AND day_of_week = $2 AND hour_of_day = $3
    ORDER BY frequency DESC
    LIMIT 2
  `, [userId, now.getDay(), now.getHours()]);

  for (const t of triggers.rows) {
    if (t.frequency >= 3) {
      suggestions.push({
        type: 'time_based',
        text: `It's ${now.getHours()}:00 - time for ${t.typical_action}?`,
        action: t.typical_action,
        confidence: Math.min(t.frequency / 10, 0.8),
        reason: 'Based on your usual schedule'
      });
    }
  }

  return suggestions;
}

/**
 * Record suggestion acceptance
 */
export async function recordSuggestionFeedback(userId, suggestionText, accepted) {
  await db.query(`
    UPDATE suggestions_log
    SET accepted = $3, acted_at = NOW()
    WHERE user_id = $1 AND suggestion_text = $2
      AND shown_at > NOW() - INTERVAL '1 hour'
    ORDER BY shown_at DESC
    LIMIT 1
  `, [userId, suggestionText, accepted]);
}

// ============================================================================
// RESOURCE PRE-FETCHING
// ============================================================================

/**
 * Predict resources that might be needed
 */
export async function predictNeededResources(userId, context) {
  await ensureSchema();

  const predictions = [];

  // Based on current file/project, predict related files
  if (context.currentFile) {
    const relatedFiles = predictRelatedFiles(context.currentFile);
    predictions.push(...relatedFiles.map(f => ({
      type: 'file',
      resource: f,
      probability: 0.6,
      reason: 'Related to current file'
    })));
  }

  // Based on action, predict needed APIs
  if (context.currentAction) {
    const apis = predictNeededAPIs(context.currentAction);
    predictions.push(...apis.map(a => ({
      type: 'api',
      resource: a,
      probability: 0.5,
      reason: 'Typically needed for this action'
    })));
  }

  return predictions;
}

/**
 * Predict related files
 */
function predictRelatedFiles(currentFile) {
  const related = [];

  // Test file
  if (!currentFile.includes('.test.') && !currentFile.includes('.spec.')) {
    const testFile = currentFile.replace(/\.(js|ts)$/, '.test.$1');
    related.push(testFile);
  }

  // Index file
  const dir = currentFile.split('/').slice(0, -1).join('/');
  related.push(`${dir}/index.js`);

  // Types file for JS
  if (currentFile.endsWith('.js')) {
    related.push(currentFile.replace('.js', '.d.ts'));
  }

  return related;
}

/**
 * Predict needed APIs based on action
 */
function predictNeededAPIs(action) {
  const apiMap = {
    'deploy': ['railway', 'netlify', 'github_actions'],
    'commit': ['github'],
    'search': ['pinecone', 'grep'],
    'test': ['jest', 'mocha'],
    'debug': ['console', 'debugger'],
    'database': ['postgres', 'redis'],
  };

  for (const [key, apis] of Object.entries(apiMap)) {
    if (action.toLowerCase().includes(key)) {
      return apis;
    }
  }

  return [];
}

// ============================================================================
// WORKFLOW ANALYSIS
// ============================================================================

/**
 * Analyze user's workflows
 */
export async function analyzeWorkflows(userId) {
  await ensureSchema();

  const workflows = [];

  // Find common action chains
  const chains = await db.query(`
    SELECT
      a1.action_a as step1,
      a1.action_b as step2,
      a2.action_b as step3,
      a1.sequence_count + a2.sequence_count as total_count
    FROM action_sequences a1
    JOIN action_sequences a2 ON a1.action_b = a2.action_a AND a1.user_id = a2.user_id
    WHERE a1.user_id = $1
      AND a1.sequence_count >= 3
      AND a2.sequence_count >= 2
    ORDER BY total_count DESC
    LIMIT 10
  `, [userId]);

  for (const chain of chains.rows) {
    workflows.push({
      steps: [chain.step1, chain.step2, chain.step3],
      frequency: chain.total_count,
      type: 'action_chain'
    });
  }

  // Find time-based workflows
  const dailyPatterns = await db.query(`
    SELECT day_of_week, hour_of_day, typical_action, frequency
    FROM time_triggers
    WHERE user_id = $1 AND frequency >= 5
    ORDER BY day_of_week, hour_of_day
  `, [userId]);

  if (dailyPatterns.rows.length > 0) {
    workflows.push({
      type: 'daily_routine',
      patterns: dailyPatterns.rows
    });
  }

  return workflows;
}

// ============================================================================
// STATISTICS
// ============================================================================

export async function getAnticipationStats(userId) {
  await ensureSchema();

  const stats = {};

  // Pattern counts
  const patterns = await db.query(`
    SELECT pattern_type, COUNT(*), AVG(confidence) as avg_conf
    FROM user_patterns
    WHERE user_id = $1
    GROUP BY pattern_type
  `, [userId]);
  stats.patterns = patterns.rows;

  // Sequence count
  const sequences = await db.query(`
    SELECT COUNT(*), SUM(sequence_count) as total_occurrences
    FROM action_sequences
    WHERE user_id = $1
  `, [userId]);
  stats.sequences = sequences.rows[0];

  // Suggestion acceptance rate
  const suggestions = await db.query(`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN accepted THEN 1 END) as accepted
    FROM suggestions_log
    WHERE user_id = $1
  `, [userId]);

  const total = parseInt(suggestions.rows[0].total);
  const accepted = parseInt(suggestions.rows[0].accepted);
  stats.suggestionAcceptRate = total > 0
    ? `${(accepted / total * 100).toFixed(1)}%`
    : 'N/A';

  return stats;
}

export default {
  recordAction,
  predictNextAction,
  generateSuggestions,
  recordSuggestionFeedback,
  predictNeededResources,
  analyzeWorkflows,
  getAnticipationStats
};
