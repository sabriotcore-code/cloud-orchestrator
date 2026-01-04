/**
 * REINFORCEMENT LEARNING LOOP
 *
 * Continuous improvement through feedback:
 * - Tracks response quality via implicit/explicit feedback
 * - Learns optimal behaviors from outcomes
 * - A/B tests different approaches
 * - Adjusts model selection and prompting strategies
 * - Self-improvement metrics and reporting
 */

import * as db from '../db/index.js';

// ============================================================================
// SCHEMA SETUP
// ============================================================================

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;

  try {
    // Response feedback tracking
    await db.query(`
      CREATE TABLE IF NOT EXISTS response_feedback (
        id SERIAL PRIMARY KEY,
        response_id VARCHAR(100),
        user_id VARCHAR(100),
        query_type VARCHAR(50),
        model_used VARCHAR(50),
        approach_used VARCHAR(50),
        response_length INTEGER,
        explicit_rating INTEGER, -- 1-5 if user rates
        implicit_signals JSONB, -- follow-ups, time spent, actions taken
        outcome VARCHAR(20), -- positive, negative, neutral
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Strategy performance
    await db.query(`
      CREATE TABLE IF NOT EXISTS strategy_performance (
        id SERIAL PRIMARY KEY,
        strategy_name VARCHAR(100),
        strategy_type VARCHAR(50), -- model_selection, prompting, routing
        context_type VARCHAR(50),
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        total_reward FLOAT DEFAULT 0,
        avg_reward FLOAT DEFAULT 0,
        last_used TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(strategy_name, context_type)
      )
    `);

    // A/B experiments
    await db.query(`
      CREATE TABLE IF NOT EXISTS rl_ab_experiments (
        id SERIAL PRIMARY KEY,
        experiment_name VARCHAR(100),
        variant_a TEXT, -- JSON config
        variant_b TEXT, -- JSON config
        variant_a_successes INTEGER DEFAULT 0,
        variant_a_trials INTEGER DEFAULT 0,
        variant_b_successes INTEGER DEFAULT 0,
        variant_b_trials INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'running', -- running, concluded
        winner VARCHAR(10), -- a, b, inconclusive
        started_at TIMESTAMPTZ DEFAULT NOW(),
        concluded_at TIMESTAMPTZ
      )
    `);

    // Behavior adjustments
    await db.query(`
      CREATE TABLE IF NOT EXISTS behavior_adjustments (
        id SERIAL PRIMARY KEY,
        adjustment_type VARCHAR(50),
        trigger_condition TEXT,
        adjustment_value TEXT,
        confidence FLOAT DEFAULT 0.5,
        times_applied INTEGER DEFAULT 0,
        success_rate FLOAT DEFAULT 0.5,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Learning metrics over time
    await db.query(`
      CREATE TABLE IF NOT EXISTS learning_metrics (
        id SERIAL PRIMARY KEY,
        metric_date DATE DEFAULT CURRENT_DATE,
        metric_type VARCHAR(50),
        metric_value FLOAT,
        context TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Indexes
    await db.query(`CREATE INDEX IF NOT EXISTS idx_feedback_user ON response_feedback(user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_feedback_outcome ON response_feedback(outcome)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_strategy_perf ON strategy_performance(strategy_name)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_learning_date ON learning_metrics(metric_date)`);

    schemaReady = true;
    console.log('[Reinforcement] Schema ready');
  } catch (err) {
    console.error('[Reinforcement] Schema setup error:', err.message);
  }
}

// ============================================================================
// FEEDBACK COLLECTION
// ============================================================================

/**
 * Record response for feedback tracking
 */
export async function recordResponse(data) {
  await ensureSchema();

  const {
    responseId,
    userId,
    queryType,
    modelUsed,
    approachUsed,
    responseLength
  } = data;

  const result = await db.query(`
    INSERT INTO response_feedback
    (response_id, user_id, query_type, model_used, approach_used, response_length, implicit_signals)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [responseId, userId, queryType, modelUsed, approachUsed, responseLength, JSON.stringify({})]);

  return result.rows[0];
}

/**
 * Record explicit user rating
 */
export async function recordExplicitRating(responseId, rating) {
  await ensureSchema();

  const outcome = rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral';

  await db.query(`
    UPDATE response_feedback
    SET explicit_rating = $2, outcome = $3
    WHERE response_id = $1
  `, [responseId, rating, outcome]);

  // Update strategy performance
  const response = await db.query(`
    SELECT * FROM response_feedback WHERE response_id = $1
  `, [responseId]);

  if (response.rows.length > 0) {
    const r = response.rows[0];
    await updateStrategyPerformance(r.approach_used, r.query_type, rating >= 4);
  }
}

/**
 * Record implicit feedback signals
 */
export async function recordImplicitSignal(responseId, signal) {
  await ensureSchema();

  const { type, value } = signal;

  // Update implicit signals JSON
  await db.query(`
    UPDATE response_feedback
    SET implicit_signals = implicit_signals || $2
    WHERE response_id = $1
  `, [responseId, JSON.stringify({ [type]: value })]);

  // Infer outcome from signals
  let inferredOutcome = null;

  if (type === 'follow_up_question') {
    // Follow-up might mean clarification needed (slightly negative)
    inferredOutcome = 'neutral';
  } else if (type === 'task_completed') {
    // Task completion is positive
    inferredOutcome = value ? 'positive' : 'negative';
  } else if (type === 'user_edited_response') {
    // User edited means not quite right
    inferredOutcome = 'neutral';
  } else if (type === 'user_said_thanks') {
    inferredOutcome = 'positive';
  } else if (type === 'error_occurred') {
    inferredOutcome = 'negative';
  }

  if (inferredOutcome) {
    await db.query(`
      UPDATE response_feedback
      SET outcome = COALESCE(outcome, $2)
      WHERE response_id = $1
    `, [responseId, inferredOutcome]);
  }
}

// ============================================================================
// STRATEGY LEARNING
// ============================================================================

/**
 * Update strategy performance based on outcome
 */
async function updateStrategyPerformance(strategyName, contextType, success) {
  await ensureSchema();

  const reward = success ? 1.0 : -0.5;

  await db.query(`
    INSERT INTO strategy_performance (strategy_name, strategy_type, context_type, success_count, failure_count, total_reward)
    VALUES ($1, 'general', $2, $3, $4, $5)
    ON CONFLICT (strategy_name, context_type)
    DO UPDATE SET
      success_count = strategy_performance.success_count + $3,
      failure_count = strategy_performance.failure_count + $4,
      total_reward = strategy_performance.total_reward + $5,
      avg_reward = (strategy_performance.total_reward + $5) /
        NULLIF(strategy_performance.success_count + strategy_performance.failure_count + 1, 0),
      last_used = NOW()
  `, [
    strategyName,
    contextType,
    success ? 1 : 0,
    success ? 0 : 1,
    reward
  ]);
}

/**
 * Get best strategy for context (epsilon-greedy selection)
 */
export async function selectStrategy(contextType, availableStrategies, epsilon = 0.1) {
  await ensureSchema();

  // Exploration: random selection with probability epsilon
  if (Math.random() < epsilon) {
    const randomIndex = Math.floor(Math.random() * availableStrategies.length);
    return {
      strategy: availableStrategies[randomIndex],
      reason: 'exploration'
    };
  }

  // Exploitation: select best performing strategy
  const performances = await db.query(`
    SELECT strategy_name, avg_reward, success_count, failure_count
    FROM strategy_performance
    WHERE context_type = $1 AND strategy_name = ANY($2)
    ORDER BY avg_reward DESC
    LIMIT 1
  `, [contextType, availableStrategies]);

  if (performances.rows.length > 0) {
    return {
      strategy: performances.rows[0].strategy_name,
      avgReward: performances.rows[0].avg_reward,
      reason: 'exploitation'
    };
  }

  // No data yet, return first strategy
  return {
    strategy: availableStrategies[0],
    reason: 'no_data'
  };
}

/**
 * Get strategy performance report
 */
export async function getStrategyReport() {
  await ensureSchema();

  const report = await db.query(`
    SELECT
      strategy_name,
      context_type,
      success_count,
      failure_count,
      avg_reward,
      success_count::float / NULLIF(success_count + failure_count, 0) as success_rate
    FROM strategy_performance
    ORDER BY avg_reward DESC
  `);

  return report.rows;
}

// ============================================================================
// A/B TESTING
// ============================================================================

/**
 * Create new A/B experiment
 */
export async function createExperiment(name, variantA, variantB) {
  await ensureSchema();

  const result = await db.query(`
    INSERT INTO rl_ab_experiments (experiment_name, variant_a, variant_b)
    VALUES ($1, $2, $3)
    RETURNING *
  `, [name, JSON.stringify(variantA), JSON.stringify(variantB)]);

  return result.rows[0];
}

/**
 * Get variant for experiment (Thompson Sampling)
 */
export async function getExperimentVariant(experimentName) {
  await ensureSchema();

  const exp = await db.query(`
    SELECT * FROM rl_ab_experiments
    WHERE experiment_name = $1 AND status = 'running'
  `, [experimentName]);

  if (exp.rows.length === 0) {
    return null;
  }

  const e = exp.rows[0];

  // Thompson Sampling using Beta distribution approximation
  const alphaA = e.variant_a_successes + 1;
  const betaA = e.variant_a_trials - e.variant_a_successes + 1;
  const alphaB = e.variant_b_successes + 1;
  const betaB = e.variant_b_trials - e.variant_b_successes + 1;

  // Sample from Beta distributions (approximation)
  const sampleA = sampleBeta(alphaA, betaA);
  const sampleB = sampleBeta(alphaB, betaB);

  const variant = sampleA > sampleB ? 'a' : 'b';
  const config = JSON.parse(variant === 'a' ? e.variant_a : e.variant_b);

  return {
    experimentId: e.id,
    variant,
    config
  };
}

/**
 * Simple Beta distribution sampling (approximation)
 */
function sampleBeta(alpha, beta) {
  // Use Gamma sampling approximation
  const gammaA = sampleGamma(alpha);
  const gammaB = sampleGamma(beta);
  return gammaA / (gammaA + gammaB);
}

/**
 * Simple Gamma sampling (Marsaglia and Tsang's method approximation)
 */
function sampleGamma(shape) {
  if (shape < 1) {
    return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  while (true) {
    let x, v;
    do {
      x = gaussianRandom();
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = Math.random();

    if (u < 1 - 0.0331 * (x * x) * (x * x)) {
      return d * v;
    }

    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
}

/**
 * Gaussian random (Box-Muller)
 */
function gaussianRandom() {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Record experiment result
 */
export async function recordExperimentResult(experimentId, variant, success) {
  await ensureSchema();

  if (variant === 'a') {
    await db.query(`
      UPDATE rl_ab_experiments
      SET variant_a_trials = variant_a_trials + 1,
          variant_a_successes = variant_a_successes + $2
      WHERE id = $1
    `, [experimentId, success ? 1 : 0]);
  } else {
    await db.query(`
      UPDATE rl_ab_experiments
      SET variant_b_trials = variant_b_trials + 1,
          variant_b_successes = variant_b_successes + $2
      WHERE id = $1
    `, [experimentId, success ? 1 : 0]);
  }

  // Check if we should conclude experiment
  await checkExperimentConclusion(experimentId);
}

/**
 * Check if experiment should conclude
 */
async function checkExperimentConclusion(experimentId) {
  const exp = await db.query(`
    SELECT * FROM rl_ab_experiments WHERE id = $1
  `, [experimentId]);

  if (exp.rows.length === 0) return;

  const e = exp.rows[0];
  const totalTrials = e.variant_a_trials + e.variant_b_trials;

  // Minimum 100 trials before concluding
  if (totalTrials < 100) return;

  // Calculate success rates
  const rateA = e.variant_a_successes / Math.max(e.variant_a_trials, 1);
  const rateB = e.variant_b_successes / Math.max(e.variant_b_trials, 1);

  // Simple significance test (difference > 5% with enough samples)
  const diff = Math.abs(rateA - rateB);
  const minSamples = Math.min(e.variant_a_trials, e.variant_b_trials);

  if (diff > 0.05 && minSamples >= 50) {
    const winner = rateA > rateB ? 'a' : 'b';

    await db.query(`
      UPDATE rl_ab_experiments
      SET status = 'concluded', winner = $2, concluded_at = NOW()
      WHERE id = $1
    `, [experimentId, winner]);

    console.log(`[Reinforcement] Experiment ${e.experiment_name} concluded. Winner: ${winner}`);

    // Record learning
    await recordLearning('experiment_conclusion', {
      experiment: e.experiment_name,
      winner,
      rateA,
      rateB
    });
  }
}

// ============================================================================
// BEHAVIOR ADJUSTMENTS
// ============================================================================

/**
 * Learn and store a behavior adjustment
 */
export async function learnAdjustment(adjustmentType, triggerCondition, adjustmentValue) {
  await ensureSchema();

  const result = await db.query(`
    INSERT INTO behavior_adjustments (adjustment_type, trigger_condition, adjustment_value)
    VALUES ($1, $2, $3)
    ON CONFLICT (adjustment_type, trigger_condition)
    DO UPDATE SET
      times_applied = behavior_adjustments.times_applied + 1,
      updated_at = NOW()
    RETURNING *
  `, [adjustmentType, triggerCondition, adjustmentValue]);

  return result.rows[0];
}

/**
 * Get applicable adjustments for current context
 */
export async function getApplicableAdjustments(context) {
  await ensureSchema();

  const adjustments = await db.query(`
    SELECT * FROM behavior_adjustments
    WHERE confidence >= 0.5
    ORDER BY confidence DESC, times_applied DESC
  `);

  // Filter to matching conditions
  const contextStr = JSON.stringify(context).toLowerCase();

  return adjustments.rows.filter(adj => {
    const trigger = adj.trigger_condition.toLowerCase();
    return contextStr.includes(trigger) || trigger === 'always';
  });
}

/**
 * Update adjustment effectiveness
 */
export async function updateAdjustmentEffectiveness(adjustmentId, wasEffective) {
  await db.query(`
    UPDATE behavior_adjustments
    SET
      times_applied = times_applied + 1,
      success_rate = (success_rate * times_applied + $2) / (times_applied + 1),
      confidence = CASE
        WHEN $2 = 1 THEN LEAST(confidence + 0.05, 0.95)
        ELSE GREATEST(confidence - 0.05, 0.1)
      END,
      updated_at = NOW()
    WHERE id = $1
  `, [adjustmentId, wasEffective ? 1 : 0]);
}

// ============================================================================
// LEARNING METRICS
// ============================================================================

/**
 * Record a learning metric
 */
export async function recordLearning(metricType, data) {
  await ensureSchema();

  const metricValue = typeof data === 'number' ? data : 1;

  await db.query(`
    INSERT INTO learning_metrics (metric_type, metric_value, context)
    VALUES ($1, $2, $3)
  `, [metricType, metricValue, JSON.stringify(data)]);
}

/**
 * Get learning progress over time
 */
export async function getLearningProgress(days = 30) {
  await ensureSchema();

  const metrics = await db.query(`
    SELECT
      metric_date,
      metric_type,
      COUNT(*) as count,
      AVG(metric_value) as avg_value
    FROM learning_metrics
    WHERE metric_date >= CURRENT_DATE - $1
    GROUP BY metric_date, metric_type
    ORDER BY metric_date DESC
  `, [days]);

  return metrics.rows;
}

/**
 * Calculate overall improvement score
 */
export async function getImprovementScore() {
  await ensureSchema();

  // Recent success rate
  const recent = await db.query(`
    SELECT
      COUNT(CASE WHEN outcome = 'positive' THEN 1 END) as positive,
      COUNT(CASE WHEN outcome = 'negative' THEN 1 END) as negative,
      COUNT(*) as total
    FROM response_feedback
    WHERE created_at >= NOW() - INTERVAL '7 days'
  `);

  // Historical success rate (previous month)
  const historical = await db.query(`
    SELECT
      COUNT(CASE WHEN outcome = 'positive' THEN 1 END) as positive,
      COUNT(*) as total
    FROM response_feedback
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND created_at < NOW() - INTERVAL '7 days'
  `);

  const recentRate = recent.rows[0].total > 0
    ? recent.rows[0].positive / recent.rows[0].total
    : 0.5;

  const historicalRate = historical.rows[0].total > 0
    ? historical.rows[0].positive / historical.rows[0].total
    : 0.5;

  const improvement = recentRate - historicalRate;

  return {
    recentSuccessRate: (recentRate * 100).toFixed(1) + '%',
    historicalSuccessRate: (historicalRate * 100).toFixed(1) + '%',
    improvement: improvement > 0 ? `+${(improvement * 100).toFixed(1)}%` : `${(improvement * 100).toFixed(1)}%`,
    trend: improvement > 0.02 ? 'improving' : improvement < -0.02 ? 'declining' : 'stable',
    recentSamples: parseInt(recent.rows[0].total),
    historicalSamples: parseInt(historical.rows[0].total)
  };
}

// ============================================================================
// COMPREHENSIVE STATS
// ============================================================================

export async function getReinforcementStats() {
  await ensureSchema();

  const stats = {};

  // Feedback summary
  const feedback = await db.query(`
    SELECT
      outcome,
      COUNT(*) as count,
      AVG(explicit_rating) as avg_rating
    FROM response_feedback
    GROUP BY outcome
  `);
  stats.feedbackSummary = feedback.rows;

  // Top performing strategies
  const strategies = await db.query(`
    SELECT strategy_name, context_type, avg_reward, success_count, failure_count
    FROM strategy_performance
    ORDER BY avg_reward DESC
    LIMIT 5
  `);
  stats.topStrategies = strategies.rows;

  // Active experiments
  const experiments = await db.query(`
    SELECT experiment_name, variant_a_trials, variant_b_trials, status, winner
    FROM rl_ab_experiments
    ORDER BY started_at DESC
    LIMIT 5
  `);
  stats.experiments = experiments.rows;

  // Improvement score
  stats.improvement = await getImprovementScore();

  return stats;
}

export default {
  // Feedback
  recordResponse,
  recordExplicitRating,
  recordImplicitSignal,

  // Strategy selection
  selectStrategy,
  getStrategyReport,

  // A/B testing
  createExperiment,
  getExperimentVariant,
  recordExperimentResult,

  // Adjustments
  learnAdjustment,
  getApplicableAdjustments,
  updateAdjustmentEffectiveness,

  // Metrics
  recordLearning,
  getLearningProgress,
  getImprovementScore,
  getReinforcementStats
};
