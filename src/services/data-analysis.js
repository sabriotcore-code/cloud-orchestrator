// ============================================================================
// DATA ANALYSIS - Statistics, Time Series, Pattern Detection, Visualization
// Comprehensive data analysis and insights extraction
// ============================================================================

import OpenAI from 'openai';

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ============================================================================
// DESCRIPTIVE STATISTICS
// ============================================================================

/**
 * Calculate comprehensive statistics for numeric data
 */
export function calculateStats(data, options = {}) {
  if (!Array.isArray(data) || data.length === 0) {
    return { error: 'Invalid or empty data' };
  }

  const numbers = data.filter(x => typeof x === 'number' && !isNaN(x));
  if (numbers.length === 0) return { error: 'No numeric data' };

  const sorted = [...numbers].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;

  // Variance and standard deviation
  const squaredDiffs = sorted.map(x => Math.pow(x - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / n;
  const stdDev = Math.sqrt(variance);

  // Percentiles
  const percentile = (p) => {
    const index = (p / 100) * (n - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] * (upper - index) + sorted[upper] * (index - lower);
  };

  // Skewness and kurtosis
  const skewness = sorted.reduce((acc, x) => acc + Math.pow((x - mean) / stdDev, 3), 0) / n;
  const kurtosis = sorted.reduce((acc, x) => acc + Math.pow((x - mean) / stdDev, 4), 0) / n - 3;

  return {
    count: n,
    sum,
    mean,
    median: percentile(50),
    mode: findMode(sorted),
    min: sorted[0],
    max: sorted[n - 1],
    range: sorted[n - 1] - sorted[0],
    variance,
    stdDev,
    coefficientOfVariation: (stdDev / mean) * 100,
    percentiles: {
      p5: percentile(5),
      p25: percentile(25),
      p50: percentile(50),
      p75: percentile(75),
      p95: percentile(95)
    },
    iqr: percentile(75) - percentile(25),
    skewness,
    kurtosis
  };
}

function findMode(sorted) {
  const counts = {};
  let maxCount = 0;
  let mode = null;

  for (const val of sorted) {
    counts[val] = (counts[val] || 0) + 1;
    if (counts[val] > maxCount) {
      maxCount = counts[val];
      mode = val;
    }
  }

  return maxCount > 1 ? mode : null;
}

/**
 * Detect outliers using various methods
 */
export function detectOutliers(data, options = {}) {
  const { method = 'iqr', threshold = 1.5 } = options;
  const stats = calculateStats(data);

  if (stats.error) return { error: stats.error };

  let outliers = [];
  let bounds = {};

  if (method === 'iqr') {
    const lowerBound = stats.percentiles.p25 - threshold * stats.iqr;
    const upperBound = stats.percentiles.p75 + threshold * stats.iqr;
    bounds = { lower: lowerBound, upper: upperBound };
    outliers = data.filter(x => x < lowerBound || x > upperBound).map((value, i) => ({
      index: data.indexOf(value),
      value,
      type: value < lowerBound ? 'low' : 'high'
    }));
  } else if (method === 'zscore') {
    const zThreshold = threshold || 3;
    outliers = data.map((value, index) => {
      const zscore = (value - stats.mean) / stats.stdDev;
      return { index, value, zscore };
    }).filter(item => Math.abs(item.zscore) > zThreshold);
    bounds = { zThreshold };
  }

  return {
    method,
    bounds,
    outlierCount: outliers.length,
    outlierPercentage: (outliers.length / data.length) * 100,
    outliers
  };
}

// ============================================================================
// CORRELATION & REGRESSION
// ============================================================================

/**
 * Calculate correlation between two variables
 */
export function calculateCorrelation(x, y, options = {}) {
  if (x.length !== y.length) return { error: 'Arrays must have same length' };

  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
  const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  const pearson = denominator === 0 ? 0 : numerator / denominator;

  // Spearman (rank correlation)
  const rankX = getRanks(x);
  const rankY = getRanks(y);
  const d2 = rankX.reduce((acc, rx, i) => acc + Math.pow(rx - rankY[i], 2), 0);
  const spearman = 1 - (6 * d2) / (n * (n * n - 1));

  return {
    pearson,
    spearman,
    strength: interpretCorrelation(pearson),
    significant: Math.abs(pearson) > 2 / Math.sqrt(n),
    r2: pearson * pearson,
    interpretation: `${Math.abs(pearson) > 0.7 ? 'Strong' : Math.abs(pearson) > 0.4 ? 'Moderate' : 'Weak'} ${pearson > 0 ? 'positive' : 'negative'} correlation`
  };
}

function getRanks(arr) {
  const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  sorted.forEach((item, rank) => { ranks[item.i] = rank + 1; });
  return ranks;
}

function interpretCorrelation(r) {
  const abs = Math.abs(r);
  if (abs >= 0.9) return 'very_strong';
  if (abs >= 0.7) return 'strong';
  if (abs >= 0.5) return 'moderate';
  if (abs >= 0.3) return 'weak';
  return 'negligible';
}

/**
 * Simple linear regression
 */
export function linearRegression(x, y) {
  if (x.length !== y.length) return { error: 'Arrays must have same length' };

  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // R-squared
  const meanY = sumY / n;
  const ssTotal = y.reduce((acc, yi) => acc + Math.pow(yi - meanY, 2), 0);
  const ssResidual = y.reduce((acc, yi, i) => acc + Math.pow(yi - (slope * x[i] + intercept), 2), 0);
  const rSquared = 1 - ssResidual / ssTotal;

  // Standard error
  const standardError = Math.sqrt(ssResidual / (n - 2));

  return {
    slope,
    intercept,
    equation: `y = ${slope.toFixed(4)}x + ${intercept.toFixed(4)}`,
    rSquared,
    standardError,
    predict: (newX) => slope * newX + intercept
  };
}

/**
 * Polynomial regression
 */
export function polynomialRegression(x, y, degree = 2) {
  if (x.length !== y.length) return { error: 'Arrays must have same length' };

  // Build Vandermonde matrix
  const n = x.length;
  const X = x.map(xi => Array.from({ length: degree + 1 }, (_, j) => Math.pow(xi, j)));

  // Normal equations: (X'X)^-1 X'y
  const XtX = matrixMultiply(transpose(X), X);
  const Xty = matrixVectorMultiply(transpose(X), y);
  const coefficients = solveLinearSystem(XtX, Xty);

  // Predictions and R-squared
  const predictions = x.map(xi =>
    coefficients.reduce((sum, c, j) => sum + c * Math.pow(xi, j), 0)
  );
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  const ssTotal = y.reduce((acc, yi) => acc + Math.pow(yi - meanY, 2), 0);
  const ssResidual = y.reduce((acc, yi, i) => acc + Math.pow(yi - predictions[i], 2), 0);

  return {
    coefficients,
    degree,
    rSquared: 1 - ssResidual / ssTotal,
    predict: (newX) => coefficients.reduce((sum, c, j) => sum + c * Math.pow(newX, j), 0)
  };
}

// Matrix helpers
function transpose(m) {
  return m[0].map((_, i) => m.map(row => row[i]));
}

function matrixMultiply(a, b) {
  return a.map(row => b[0].map((_, j) => row.reduce((sum, _, k) => sum + row[k] * b[k][j], 0)));
}

function matrixVectorMultiply(m, v) {
  return m.map(row => row.reduce((sum, val, i) => sum + val * v[i], 0));
}

function solveLinearSystem(A, b) {
  // Gaussian elimination (simplified)
  const n = A.length;
  const aug = A.map((row, i) => [...row, b[i]]);

  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) maxRow = k;
    }
    [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];

    for (let k = i + 1; k < n; k++) {
      const c = aug[k][i] / aug[i][i];
      for (let j = i; j <= n; j++) aug[k][j] -= c * aug[i][j];
    }
  }

  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= aug[i][j] * x[j];
    x[i] /= aug[i][i];
  }

  return x;
}

// ============================================================================
// TIME SERIES ANALYSIS
// ============================================================================

/**
 * Calculate moving average
 */
export function movingAverage(data, window = 3) {
  if (window > data.length) return { error: 'Window larger than data' };

  const result = [];
  for (let i = window - 1; i < data.length; i++) {
    const slice = data.slice(i - window + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / window);
  }

  return {
    window,
    values: result,
    original: data,
    smoothed: data.map((_, i) => i < window - 1 ? null : result[i - window + 1])
  };
}

/**
 * Exponential smoothing
 */
export function exponentialSmoothing(data, alpha = 0.3) {
  const smoothed = [data[0]];

  for (let i = 1; i < data.length; i++) {
    smoothed.push(alpha * data[i] + (1 - alpha) * smoothed[i - 1]);
  }

  return {
    alpha,
    smoothed,
    forecast: alpha * data[data.length - 1] + (1 - alpha) * smoothed[smoothed.length - 1]
  };
}

/**
 * Detect trend in time series
 */
export function detectTrend(data, options = {}) {
  const n = data.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const regression = linearRegression(x, data);

  const trendDirection = regression.slope > 0 ? 'increasing' : regression.slope < 0 ? 'decreasing' : 'stable';
  const trendStrength = Math.abs(regression.slope) / (Math.max(...data) - Math.min(...data) || 1);

  // Mann-Kendall trend test (simplified)
  let s = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      s += Math.sign(data[j] - data[i]);
    }
  }
  const variance = (n * (n - 1) * (2 * n + 5)) / 18;
  const z = s / Math.sqrt(variance);

  return {
    direction: trendDirection,
    slope: regression.slope,
    slopePerUnit: regression.slope,
    strength: trendStrength,
    mannKendall: { s, z, significant: Math.abs(z) > 1.96 },
    regression
  };
}

/**
 * Detect seasonality
 */
export function detectSeasonality(data, maxPeriod = null) {
  const n = data.length;
  maxPeriod = maxPeriod || Math.floor(n / 2);

  const autocorrelations = [];

  for (let lag = 1; lag <= maxPeriod; lag++) {
    const mean = data.reduce((a, b) => a + b, 0) / n;
    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n - lag; i++) {
      numerator += (data[i] - mean) * (data[i + lag] - mean);
    }
    for (let i = 0; i < n; i++) {
      denominator += Math.pow(data[i] - mean, 2);
    }

    autocorrelations.push({
      lag,
      correlation: numerator / denominator
    });
  }

  // Find peaks in autocorrelation
  const peaks = autocorrelations.filter((ac, i) => {
    if (i === 0 || i === autocorrelations.length - 1) return false;
    return ac.correlation > autocorrelations[i - 1].correlation &&
           ac.correlation > autocorrelations[i + 1].correlation &&
           ac.correlation > 0.3;
  });

  return {
    seasonal: peaks.length > 0,
    dominantPeriod: peaks.length > 0 ? peaks[0].lag : null,
    peaks,
    autocorrelations: autocorrelations.slice(0, 20)
  };
}

/**
 * Decompose time series into trend, seasonal, and residual
 */
export function decompose(data, period = null) {
  // Auto-detect period if not provided
  if (!period) {
    const seasonality = detectSeasonality(data);
    period = seasonality.dominantPeriod || 4;
  }

  // Calculate trend using moving average
  const trend = movingAverage(data, period).smoothed;

  // Detrend
  const detrended = data.map((val, i) => trend[i] !== null ? val - trend[i] : null);

  // Calculate seasonal component
  const seasonal = new Array(data.length).fill(0);
  for (let i = 0; i < period; i++) {
    const values = [];
    for (let j = i; j < data.length; j += period) {
      if (detrended[j] !== null) values.push(detrended[j]);
    }
    const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    for (let j = i; j < data.length; j += period) {
      seasonal[j] = avg;
    }
  }

  // Calculate residual
  const residual = data.map((val, i) => {
    if (trend[i] === null) return null;
    return val - trend[i] - seasonal[i];
  });

  return {
    original: data,
    trend,
    seasonal,
    residual,
    period
  };
}

// ============================================================================
// PATTERN DETECTION
// ============================================================================

/**
 * Detect patterns using AI
 */
export async function detectPatterns(data, context = '', options = {}) {
  if (!openai) throw new Error('OpenAI required for pattern detection');

  const stats = calculateStats(data);
  const trend = detectTrend(data);
  const seasonality = detectSeasonality(data);
  const outliers = detectOutliers(data);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a data analyst expert. Analyze data patterns and provide insights.
Return JSON:
{
  "patterns": [{"pattern": "name", "description": "...", "confidence": 0-1, "evidence": "..."}],
  "anomalies": [{"index": 0, "value": 0, "reason": "why anomalous"}],
  "insights": ["key insight 1", "key insight 2"],
  "predictions": {"shortTerm": "...", "longTerm": "..."},
  "recommendations": ["action 1", "action 2"]
}`
      },
      {
        role: 'user',
        content: `Data: ${JSON.stringify(data.slice(0, 100))}
Stats: ${JSON.stringify(stats)}
Trend: ${JSON.stringify(trend)}
Seasonality: ${JSON.stringify(seasonality)}
Outliers: ${JSON.stringify(outliers)}
Context: ${context}`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  return {
    ...JSON.parse(response.choices[0].message.content),
    stats,
    trend,
    seasonality,
    outliers
  };
}

/**
 * Find clusters in data
 */
export function kMeansClustering(data, k = 3, maxIterations = 100) {
  if (!Array.isArray(data[0])) {
    // 1D data - convert to 2D for clustering
    data = data.map((val, i) => [i, val]);
  }

  const n = data.length;
  const dimensions = data[0].length;

  // Initialize centroids randomly
  let centroids = [];
  const indices = new Set();
  while (centroids.length < k) {
    const idx = Math.floor(Math.random() * n);
    if (!indices.has(idx)) {
      indices.add(idx);
      centroids.push([...data[idx]]);
    }
  }

  let assignments = new Array(n).fill(0);
  let changed = true;
  let iterations = 0;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    // Assign points to nearest centroid
    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      let nearestCluster = 0;

      for (let j = 0; j < k; j++) {
        const dist = euclideanDistance(data[i], centroids[j]);
        if (dist < minDist) {
          minDist = dist;
          nearestCluster = j;
        }
      }

      if (assignments[i] !== nearestCluster) {
        assignments[i] = nearestCluster;
        changed = true;
      }
    }

    // Update centroids
    for (let j = 0; j < k; j++) {
      const clusterPoints = data.filter((_, i) => assignments[i] === j);
      if (clusterPoints.length > 0) {
        for (let d = 0; d < dimensions; d++) {
          centroids[j][d] = clusterPoints.reduce((sum, p) => sum + p[d], 0) / clusterPoints.length;
        }
      }
    }
  }

  // Calculate cluster statistics
  const clusters = Array.from({ length: k }, () => []);
  data.forEach((point, i) => clusters[assignments[i]].push(point));

  return {
    k,
    iterations,
    centroids,
    assignments,
    clusters: clusters.map((cluster, i) => ({
      id: i,
      size: cluster.length,
      centroid: centroids[i],
      members: cluster
    }))
  };
}

function euclideanDistance(a, b) {
  return Math.sqrt(a.reduce((sum, val, i) => sum + Math.pow(val - b[i], 2), 0));
}

// ============================================================================
// HYPOTHESIS TESTING
// ============================================================================

/**
 * T-test for comparing means
 */
export function tTest(sample1, sample2, options = {}) {
  const { paired = false, alpha = 0.05 } = options;

  const n1 = sample1.length;
  const n2 = sample2.length;
  const mean1 = sample1.reduce((a, b) => a + b, 0) / n1;
  const mean2 = sample2.reduce((a, b) => a + b, 0) / n2;
  const var1 = sample1.reduce((acc, x) => acc + Math.pow(x - mean1, 2), 0) / (n1 - 1);
  const var2 = sample2.reduce((acc, x) => acc + Math.pow(x - mean2, 2), 0) / (n2 - 1);

  let tStatistic, df;

  if (paired) {
    if (n1 !== n2) return { error: 'Paired t-test requires equal sample sizes' };
    const diffs = sample1.map((x, i) => x - sample2[i]);
    const meanDiff = diffs.reduce((a, b) => a + b, 0) / n1;
    const varDiff = diffs.reduce((acc, d) => acc + Math.pow(d - meanDiff, 2), 0) / (n1 - 1);
    tStatistic = meanDiff / Math.sqrt(varDiff / n1);
    df = n1 - 1;
  } else {
    const pooledSE = Math.sqrt(var1 / n1 + var2 / n2);
    tStatistic = (mean1 - mean2) / pooledSE;
    df = Math.pow(var1 / n1 + var2 / n2, 2) /
         (Math.pow(var1 / n1, 2) / (n1 - 1) + Math.pow(var2 / n2, 2) / (n2 - 1));
  }

  // Approximate p-value using normal distribution for large df
  const pValue = 2 * (1 - normalCDF(Math.abs(tStatistic)));

  return {
    tStatistic,
    degreesOfFreedom: df,
    pValue,
    significant: pValue < alpha,
    alpha,
    means: { sample1: mean1, sample2: mean2 },
    difference: mean1 - mean2,
    interpretation: pValue < alpha
      ? 'Significant difference between groups'
      : 'No significant difference between groups'
  };
}

function normalCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Chi-square test for independence
 */
export function chiSquareTest(observed, expected = null) {
  // observed is a 2D contingency table
  const rows = observed.length;
  const cols = observed[0].length;

  // Calculate expected if not provided
  if (!expected) {
    const rowTotals = observed.map(row => row.reduce((a, b) => a + b, 0));
    const colTotals = observed[0].map((_, j) => observed.reduce((sum, row) => sum + row[j], 0));
    const total = rowTotals.reduce((a, b) => a + b, 0);

    expected = observed.map((row, i) =>
      row.map((_, j) => (rowTotals[i] * colTotals[j]) / total)
    );
  }

  // Calculate chi-square statistic
  let chiSquare = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      chiSquare += Math.pow(observed[i][j] - expected[i][j], 2) / expected[i][j];
    }
  }

  const df = (rows - 1) * (cols - 1);

  // Approximate p-value
  const pValue = 1 - chiSquareCDF(chiSquare, df);

  return {
    chiSquare,
    degreesOfFreedom: df,
    pValue,
    significant: pValue < 0.05,
    expected,
    interpretation: pValue < 0.05
      ? 'Variables are dependent (significant association)'
      : 'Variables are independent (no significant association)'
  };
}

function chiSquareCDF(x, df) {
  // Simplified approximation
  if (x <= 0) return 0;
  const k = df / 2;
  return 1 - Math.exp(-x / 2) * Math.pow(x / 2, k - 1) / gamma(k);
}

function gamma(n) {
  if (n === 1) return 1;
  if (n === 0.5) return Math.sqrt(Math.PI);
  return (n - 1) * gamma(n - 1);
}

// ============================================================================
// DATA TRANSFORMATION
// ============================================================================

/**
 * Normalize data
 */
export function normalize(data, options = {}) {
  const { method = 'minmax' } = options;
  const numbers = data.filter(x => typeof x === 'number');

  if (method === 'minmax') {
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    const range = max - min || 1;
    return {
      normalized: data.map(x => (x - min) / range),
      method,
      params: { min, max }
    };
  } else if (method === 'zscore') {
    const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
    const std = Math.sqrt(numbers.reduce((acc, x) => acc + Math.pow(x - mean, 2), 0) / numbers.length);
    return {
      normalized: data.map(x => (x - mean) / (std || 1)),
      method,
      params: { mean, std }
    };
  }
}

/**
 * Bin continuous data
 */
export function binData(data, bins = 10, options = {}) {
  const { method = 'equal_width' } = options;
  const min = Math.min(...data);
  const max = Math.max(...data);

  let edges;
  if (method === 'equal_width') {
    const width = (max - min) / bins;
    edges = Array.from({ length: bins + 1 }, (_, i) => min + i * width);
  } else if (method === 'quantile') {
    const sorted = [...data].sort((a, b) => a - b);
    edges = Array.from({ length: bins + 1 }, (_, i) =>
      sorted[Math.floor(i * data.length / bins)] || max
    );
  }

  const binned = data.map(val => {
    for (let i = 0; i < edges.length - 1; i++) {
      if (val >= edges[i] && val < edges[i + 1]) return i;
    }
    return bins - 1;
  });

  const counts = new Array(bins).fill(0);
  binned.forEach(b => counts[b]++);

  return {
    binned,
    edges,
    counts,
    bins: edges.slice(0, -1).map((edge, i) => ({
      index: i,
      range: [edge, edges[i + 1]],
      count: counts[i],
      percentage: (counts[i] / data.length) * 100
    }))
  };
}

// ============================================================================
// AI-POWERED ANALYSIS
// ============================================================================

/**
 * Get AI insights about data
 */
export async function analyzeWithAI(data, question, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const stats = calculateStats(data);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a data scientist. Analyze data and answer questions.
Return JSON:
{
  "answer": "direct answer to question",
  "analysis": "detailed analysis",
  "insights": ["insight 1", "insight 2"],
  "visualizationSuggestions": ["chart type 1", "chart type 2"],
  "furtherQuestions": ["follow-up question 1"]
}`
      },
      {
        role: 'user',
        content: `Data summary: ${JSON.stringify(stats)}
Sample (first 50): ${JSON.stringify(data.slice(0, 50))}
Question: ${question}`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1500
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    statistics: true,
    correlation: true,
    regression: true,
    timeSeries: true,
    patternDetection: !!openai,
    clustering: true,
    hypothesisTesting: true,
    aiAnalysis: !!openai,
    capabilities: [
      'descriptive_stats', 'outlier_detection',
      'correlation', 'linear_regression', 'polynomial_regression',
      'moving_average', 'exponential_smoothing', 'trend_detection',
      'seasonality_detection', 'decomposition',
      'pattern_detection', 'clustering',
      't_test', 'chi_square',
      'normalization', 'binning',
      'ai_analysis'
    ],
    ready: true
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Statistics
  calculateStats, detectOutliers,
  // Correlation & Regression
  calculateCorrelation, linearRegression, polynomialRegression,
  // Time Series
  movingAverage, exponentialSmoothing, detectTrend, detectSeasonality, decompose,
  // Pattern Detection
  detectPatterns, kMeansClustering,
  // Hypothesis Testing
  tTest, chiSquareTest,
  // Transformation
  normalize, binData,
  // AI
  analyzeWithAI
};
