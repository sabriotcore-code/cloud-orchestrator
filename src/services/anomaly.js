/**
 * ANOMALY DETECTION SYSTEM
 *
 * Proactive issue identification:
 * - Statistical anomaly detection (Z-score, IQR)
 * - Pattern deviation detection
 * - Real-time alerting
 * - Trend anomalies
 * - Multi-dimensional analysis
 */

import * as db from '../db/index.js';

// ============================================================================
// STATISTICAL METHODS
// ============================================================================

/**
 * Detect anomalies using Z-score method
 */
export function detectZScore(data, threshold = 2.5) {
  if (data.length < 3) return { anomalies: [], method: 'z-score', error: 'Insufficient data' };

  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  const variance = data.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / data.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return { anomalies: [], method: 'z-score', note: 'No variance in data' };

  const anomalies = [];

  data.forEach((value, index) => {
    const zScore = (value - mean) / stdDev;

    if (Math.abs(zScore) > threshold) {
      anomalies.push({
        index,
        value,
        zScore,
        severity: Math.abs(zScore) > threshold * 1.5 ? 'critical' : 'warning',
        direction: zScore > 0 ? 'high' : 'low'
      });
    }
  });

  return {
    anomalies,
    method: 'z-score',
    threshold,
    statistics: { mean, stdDev, count: data.length }
  };
}

/**
 * Detect anomalies using IQR (Interquartile Range) method
 */
export function detectIQR(data, multiplier = 1.5) {
  if (data.length < 4) return { anomalies: [], method: 'iqr', error: 'Insufficient data' };

  const sorted = [...data].sort((a, b) => a - b);
  const n = sorted.length;

  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;

  const lowerBound = q1 - multiplier * iqr;
  const upperBound = q3 + multiplier * iqr;

  const anomalies = [];

  data.forEach((value, index) => {
    if (value < lowerBound || value > upperBound) {
      const distance = value < lowerBound
        ? (lowerBound - value) / iqr
        : (value - upperBound) / iqr;

      anomalies.push({
        index,
        value,
        severity: distance > 2 ? 'critical' : 'warning',
        direction: value < lowerBound ? 'low' : 'high',
        deviation: distance
      });
    }
  });

  return {
    anomalies,
    method: 'iqr',
    bounds: { lower: lowerBound, upper: upperBound },
    quartiles: { q1, q3, iqr }
  };
}

/**
 * Detect anomalies using Isolation Forest concept (simplified)
 */
export function detectIsolation(data, contamination = 0.1) {
  if (data.length < 10) return { anomalies: [], method: 'isolation', error: 'Need at least 10 points' };

  // Calculate isolation scores based on how far each point is from clusters
  const scores = data.map((value, index) => {
    // Distance to all other points
    const distances = data.map((other, i) => i === index ? Infinity : Math.abs(value - other));
    const avgDistance = distances.filter(d => d !== Infinity).reduce((a, b) => a + b, 0) / (data.length - 1);

    // Points with high average distance are more isolated
    return { index, value, score: avgDistance };
  });

  // Sort by isolation score
  scores.sort((a, b) => b.score - a.score);

  // Top contamination% are anomalies
  const numAnomalies = Math.max(1, Math.floor(data.length * contamination));
  const threshold = scores[numAnomalies - 1].score;

  const anomalies = scores.slice(0, numAnomalies).map(s => ({
    index: s.index,
    value: s.value,
    isolationScore: s.score,
    severity: s.score > threshold * 1.5 ? 'critical' : 'warning'
  }));

  return {
    anomalies,
    method: 'isolation',
    contamination,
    threshold
  };
}

// ============================================================================
// PATTERN DETECTION
// ============================================================================

/**
 * Detect sudden changes (point anomalies)
 */
export function detectSuddenChanges(data, windowSize = 5, threshold = 2) {
  if (data.length < windowSize * 2) {
    return { anomalies: [], method: 'sudden-change', error: 'Insufficient data' };
  }

  const anomalies = [];

  for (let i = windowSize; i < data.length; i++) {
    const prevWindow = data.slice(i - windowSize, i);
    const prevMean = prevWindow.reduce((a, b) => a + b, 0) / windowSize;
    const prevStdDev = Math.sqrt(
      prevWindow.reduce((sum, x) => sum + Math.pow(x - prevMean, 2), 0) / windowSize
    );

    const current = data[i];
    const deviation = prevStdDev > 0 ? Math.abs(current - prevMean) / prevStdDev : 0;

    if (deviation > threshold) {
      anomalies.push({
        index: i,
        value: current,
        expectedRange: { low: prevMean - prevStdDev, high: prevMean + prevStdDev },
        deviation,
        severity: deviation > threshold * 1.5 ? 'critical' : 'warning',
        direction: current > prevMean ? 'spike' : 'drop'
      });
    }
  }

  return {
    anomalies,
    method: 'sudden-change',
    windowSize,
    threshold
  };
}

/**
 * Detect trend breaks
 */
export function detectTrendBreaks(data, windowSize = 10, sensitivityThreshold = 0.5) {
  if (data.length < windowSize * 3) {
    return { anomalies: [], method: 'trend-break', error: 'Insufficient data' };
  }

  const anomalies = [];

  for (let i = windowSize; i < data.length - windowSize; i++) {
    // Calculate slope before and after point
    const before = data.slice(i - windowSize, i);
    const after = data.slice(i, i + windowSize);

    const slopeBefore = calculateSlope(before);
    const slopeAfter = calculateSlope(after);

    const slopeChange = Math.abs(slopeAfter - slopeBefore);

    if (slopeChange > sensitivityThreshold) {
      anomalies.push({
        index: i,
        value: data[i],
        slopeBefore,
        slopeAfter,
        slopeChange,
        severity: slopeChange > sensitivityThreshold * 2 ? 'critical' : 'warning',
        type: slopeAfter > slopeBefore ? 'acceleration' : 'deceleration'
      });
    }
  }

  return {
    anomalies,
    method: 'trend-break',
    windowSize,
    sensitivityThreshold
  };
}

/**
 * Calculate slope of data
 */
function calculateSlope(data) {
  const n = data.length;
  const xMean = (n - 1) / 2;
  const yMean = data.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (data[i] - yMean);
    denominator += Math.pow(i - xMean, 2);
  }

  return denominator !== 0 ? numerator / denominator : 0;
}

// ============================================================================
// MULTI-DIMENSIONAL ANALYSIS
// ============================================================================

/**
 * Detect anomalies across multiple metrics
 */
export function detectMultiDimensional(metrics, options = {}) {
  const { threshold = 2 } = options;

  // metrics format: { metricName: [values], ... }
  const metricNames = Object.keys(metrics);
  const numPoints = metrics[metricNames[0]]?.length || 0;

  if (numPoints < 5) {
    return { anomalies: [], method: 'multi-dimensional', error: 'Insufficient data' };
  }

  // Detect anomalies per metric
  const perMetric = {};
  for (const name of metricNames) {
    perMetric[name] = detectZScore(metrics[name], threshold);
  }

  // Find points that are anomalous in multiple metrics
  const anomalyScores = Array(numPoints).fill(0);
  const anomalyDetails = Array(numPoints).fill(null).map(() => ({}));

  for (const name of metricNames) {
    for (const anomaly of perMetric[name].anomalies) {
      anomalyScores[anomaly.index]++;
      anomalyDetails[anomaly.index][name] = anomaly;
    }
  }

  const multiAnomalies = [];
  for (let i = 0; i < numPoints; i++) {
    if (anomalyScores[i] >= 2) {
      multiAnomalies.push({
        index: i,
        metricsAffected: anomalyScores[i],
        totalMetrics: metricNames.length,
        severity: anomalyScores[i] >= metricNames.length / 2 ? 'critical' : 'warning',
        details: anomalyDetails[i]
      });
    }
  }

  return {
    anomalies: multiAnomalies,
    method: 'multi-dimensional',
    perMetricResults: perMetric,
    metricsAnalyzed: metricNames
  };
}

// ============================================================================
// COMBINED DETECTION
// ============================================================================

/**
 * Run multiple detection methods and combine results
 */
export function detectAll(data, options = {}) {
  const { methods = ['zscore', 'iqr', 'sudden-change'] } = options;

  const results = {};

  if (methods.includes('zscore')) {
    results.zscore = detectZScore(data);
  }

  if (methods.includes('iqr')) {
    results.iqr = detectIQR(data);
  }

  if (methods.includes('sudden-change')) {
    results.suddenChange = detectSuddenChanges(data);
  }

  if (methods.includes('trend-break')) {
    results.trendBreak = detectTrendBreaks(data);
  }

  if (methods.includes('isolation')) {
    results.isolation = detectIsolation(data);
  }

  // Combine anomalies with voting
  const votes = {};
  for (const [method, result] of Object.entries(results)) {
    for (const anomaly of result.anomalies || []) {
      const key = anomaly.index;
      if (!votes[key]) {
        votes[key] = { index: key, value: anomaly.value, methods: [], severity: 'warning' };
      }
      votes[key].methods.push(method);
      if (anomaly.severity === 'critical') {
        votes[key].severity = 'critical';
      }
    }
  }

  // Filter to anomalies detected by multiple methods
  const confirmed = Object.values(votes)
    .filter(v => v.methods.length >= 2)
    .sort((a, b) => b.methods.length - a.methods.length);

  return {
    methodResults: results,
    confirmedAnomalies: confirmed,
    summary: {
      dataPoints: data.length,
      methodsUsed: methods,
      totalAnomaliesFound: Object.keys(votes).length,
      confirmedAnomalies: confirmed.length,
      criticalAnomalies: confirmed.filter(a => a.severity === 'critical').length
    }
  };
}

// ============================================================================
// ALERTING
// ============================================================================

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS anomaly_alerts (
        id SERIAL PRIMARY KEY,
        metric_name VARCHAR(100),
        anomaly_type VARCHAR(50),
        severity VARCHAR(20),
        value FLOAT,
        expected_range JSONB,
        detected_at TIMESTAMPTZ DEFAULT NOW(),
        acknowledged BOOLEAN DEFAULT FALSE,
        acknowledged_at TIMESTAMPTZ,
        notes TEXT
      )
    `);

    await db.query(`CREATE INDEX IF NOT EXISTS idx_alerts_severity ON anomaly_alerts(severity, acknowledged)`);

    schemaReady = true;
  } catch (e) {
    console.error('[Anomaly] Schema error:', e.message);
  }
}

/**
 * Create anomaly alert
 */
export async function createAlert(metricName, anomaly, anomalyType) {
  await ensureSchema();

  const result = await db.query(`
    INSERT INTO anomaly_alerts (metric_name, anomaly_type, severity, value, expected_range)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [
    metricName,
    anomalyType,
    anomaly.severity,
    anomaly.value,
    JSON.stringify(anomaly.expectedRange || { note: 'See detection details' })
  ]);

  return result.rows[0];
}

/**
 * Get unacknowledged alerts
 */
export async function getActiveAlerts(severity = null) {
  await ensureSchema();

  let query = `
    SELECT * FROM anomaly_alerts
    WHERE acknowledged = FALSE
  `;
  const params = [];

  if (severity) {
    query += ` AND severity = $1`;
    params.push(severity);
  }

  query += ` ORDER BY detected_at DESC LIMIT 50`;

  const result = await db.query(query, params);
  return result.rows;
}

/**
 * Acknowledge alert
 */
export async function acknowledgeAlert(alertId, notes = null) {
  await ensureSchema();

  await db.query(`
    UPDATE anomaly_alerts
    SET acknowledged = TRUE, acknowledged_at = NOW(), notes = $2
    WHERE id = $1
  `, [alertId, notes]);
}

/**
 * Get anomaly statistics
 */
export async function getAnomalyStats(hours = 24) {
  await ensureSchema();

  const result = await db.query(`
    SELECT
      metric_name,
      severity,
      COUNT(*) as count,
      MIN(detected_at) as first_seen,
      MAX(detected_at) as last_seen
    FROM anomaly_alerts
    WHERE detected_at > NOW() - INTERVAL '1 hour' * $1
    GROUP BY metric_name, severity
    ORDER BY count DESC
  `, [hours]);

  return result.rows;
}

export default {
  // Statistical
  detectZScore,
  detectIQR,
  detectIsolation,

  // Pattern
  detectSuddenChanges,
  detectTrendBreaks,

  // Multi-dimensional
  detectMultiDimensional,

  // Combined
  detectAll,

  // Alerting
  createAlert,
  getActiveAlerts,
  acknowledgeAlert,
  getAnomalyStats
};
