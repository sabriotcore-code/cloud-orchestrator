/**
 * MULTI-MODAL + PREDICTIVE ANALYTICS
 *
 * Process images, documents, audio + statistical forecasting:
 * - Vision analysis (GPT-4V, Gemini Vision)
 * - Document parsing and understanding
 * - Time series forecasting
 * - Trend prediction
 * - Resource capacity planning
 */

import * as db from '../db/index.js';
import * as aiProviders from './ai-providers.js';
import fetch from 'node-fetch';

// ============================================================================
// VISION ANALYSIS
// ============================================================================

/**
 * Analyze image using vision-capable models
 */
export async function analyzeImage(imageUrl, prompt = 'Describe this image in detail') {
  const start = Date.now();

  try {
    // Try Gemini Vision first (usually faster)
    const result = await analyzeWithGemini(imageUrl, prompt);
    return {
      ...result,
      provider: 'gemini',
      latencyMs: Date.now() - start
    };
  } catch (e) {
    // Fallback to GPT-4V
    try {
      const result = await analyzeWithGPT4V(imageUrl, prompt);
      return {
        ...result,
        provider: 'gpt4v',
        latencyMs: Date.now() - start
      };
    } catch (e2) {
      return {
        error: `Vision analysis failed: ${e2.message}`,
        latencyMs: Date.now() - start
      };
    }
  }
}

/**
 * Analyze with Gemini Vision
 */
async function analyzeWithGemini(imageUrl, prompt) {
  const response = await aiProviders.chat('gemini', prompt, {
    images: [imageUrl]
  });
  return { analysis: response.response };
}

/**
 * Analyze with GPT-4V
 */
async function analyzeWithGPT4V(imageUrl, prompt) {
  const response = await aiProviders.chat('gpt4o', prompt, {
    images: [imageUrl]
  });
  return { analysis: response.response };
}

/**
 * Extract text from image (OCR)
 */
export async function extractText(imageUrl) {
  return analyzeImage(imageUrl, 'Extract and transcribe all text visible in this image. Preserve formatting where possible.');
}

/**
 * Analyze document/screenshot
 */
export async function analyzeDocument(imageUrl, documentType = 'general') {
  const prompts = {
    invoice: 'Extract all invoice details: vendor, date, line items, amounts, total, due date.',
    receipt: 'Extract receipt details: merchant, date, items purchased, amounts, payment method.',
    contract: 'Summarize key terms: parties, dates, obligations, payment terms, important clauses.',
    spreadsheet: 'Extract the data from this spreadsheet. Identify column headers and row data.',
    general: 'Analyze this document. Extract key information, structure, and important details.'
  };

  const prompt = prompts[documentType] || prompts.general;
  return analyzeImage(imageUrl, prompt);
}

// ============================================================================
// TIME SERIES FORECASTING
// ============================================================================

/**
 * Forecast future values from time series data
 */
export async function forecast(data, options = {}) {
  const {
    periods = 7,
    frequency = 'daily',
    method = 'auto'
  } = options;

  // Validate data
  if (!Array.isArray(data) || data.length < 3) {
    return { error: 'Need at least 3 data points for forecasting' };
  }

  // Calculate statistics
  const stats = calculateStats(data);

  // Detect trend
  const trend = detectTrend(data);

  // Detect seasonality
  const seasonality = detectSeasonality(data, frequency);

  // Generate forecast based on method
  let predictions;
  switch (method) {
    case 'linear':
      predictions = linearForecast(data, periods, trend);
      break;
    case 'exponential':
      predictions = exponentialSmoothing(data, periods);
      break;
    case 'auto':
    default:
      // Use best method based on data characteristics
      if (Math.abs(trend.slope) > stats.stdDev * 0.1) {
        predictions = linearForecast(data, periods, trend);
      } else {
        predictions = exponentialSmoothing(data, periods);
      }
  }

  // Calculate confidence intervals
  const intervals = calculateConfidenceIntervals(predictions, stats.stdDev);

  return {
    predictions,
    intervals,
    statistics: stats,
    trend,
    seasonality,
    method: method === 'auto' ? (Math.abs(trend.slope) > stats.stdDev * 0.1 ? 'linear' : 'exponential') : method,
    periods
  };
}

/**
 * Calculate basic statistics
 */
function calculateStats(data) {
  const n = data.length;
  const mean = data.reduce((a, b) => a + b, 0) / n;
  const variance = data.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  const min = Math.min(...data);
  const max = Math.max(...data);

  return { mean, variance, stdDev, min, max, count: n };
}

/**
 * Detect linear trend
 */
function detectTrend(data) {
  const n = data.length;
  const xMean = (n - 1) / 2;
  const yMean = data.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (data[i] - yMean);
    denominator += Math.pow(i - xMean, 2);
  }

  const slope = denominator !== 0 ? numerator / denominator : 0;
  const intercept = yMean - slope * xMean;
  const direction = slope > 0.01 ? 'increasing' : slope < -0.01 ? 'decreasing' : 'stable';

  return { slope, intercept, direction };
}

/**
 * Detect seasonality
 */
function detectSeasonality(data, frequency) {
  const periods = {
    daily: 7,
    weekly: 4,
    monthly: 12,
    quarterly: 4
  };

  const period = periods[frequency] || 7;

  if (data.length < period * 2) {
    return { detected: false, reason: 'Insufficient data for seasonality detection' };
  }

  // Simple autocorrelation at period lag
  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < data.length - period; i++) {
    numerator += (data[i] - mean) * (data[i + period] - mean);
  }

  for (let i = 0; i < data.length; i++) {
    denominator += Math.pow(data[i] - mean, 2);
  }

  const autocorr = denominator !== 0 ? numerator / denominator : 0;

  return {
    detected: autocorr > 0.5,
    autocorrelation: autocorr,
    period,
    frequency
  };
}

/**
 * Linear forecast
 */
function linearForecast(data, periods, trend) {
  const n = data.length;
  const predictions = [];

  for (let i = 1; i <= periods; i++) {
    const predicted = trend.intercept + trend.slope * (n + i - 1);
    predictions.push(Math.max(0, predicted)); // No negative values
  }

  return predictions;
}

/**
 * Exponential smoothing forecast
 */
function exponentialSmoothing(data, periods, alpha = 0.3) {
  // Simple exponential smoothing
  let smoothed = data[0];

  for (let i = 1; i < data.length; i++) {
    smoothed = alpha * data[i] + (1 - alpha) * smoothed;
  }

  // Forecast is just the last smoothed value
  return Array(periods).fill(smoothed);
}

/**
 * Calculate confidence intervals
 */
function calculateConfidenceIntervals(predictions, stdDev) {
  return predictions.map((pred, i) => {
    // Wider intervals for further predictions
    const widthMultiplier = 1 + (i * 0.1);
    const margin = 1.96 * stdDev * widthMultiplier;

    return {
      lower: Math.max(0, pred - margin),
      upper: pred + margin,
      predicted: pred
    };
  });
}

// ============================================================================
// PREDICTIVE ANALYTICS
// ============================================================================

/**
 * Predict resource capacity needs
 */
export async function predictCapacity(historicalUsage, options = {}) {
  const { threshold = 0.8, planningHorizon = 30 } = options;

  const forecastResult = await forecast(historicalUsage, { periods: planningHorizon });

  if (forecastResult.error) {
    return forecastResult;
  }

  // Find when capacity threshold is exceeded
  const maxCapacity = Math.max(...historicalUsage) / threshold;
  const exceedanceDay = forecastResult.predictions.findIndex(p => p > maxCapacity * threshold);

  return {
    ...forecastResult,
    capacity: {
      current: historicalUsage[historicalUsage.length - 1],
      estimatedMax: maxCapacity,
      threshold: threshold * 100 + '%',
      daysUntilThreshold: exceedanceDay === -1 ? null : exceedanceDay + 1,
      recommendation: exceedanceDay !== -1 && exceedanceDay < 14
        ? 'URGENT: Capacity expansion needed within 2 weeks'
        : exceedanceDay !== -1
          ? 'Plan capacity expansion within the month'
          : 'Capacity sufficient for planning horizon'
    }
  };
}

/**
 * Predict failure probability
 */
export async function predictFailure(errorRates, options = {}) {
  const { warningThreshold = 0.05, criticalThreshold = 0.1, periods = 7 } = options;

  const forecastResult = await forecast(errorRates, { periods });

  if (forecastResult.error) {
    return forecastResult;
  }

  const currentRate = errorRates[errorRates.length - 1];
  const predictedMax = Math.max(...forecastResult.predictions);

  let risk = 'low';
  if (predictedMax > criticalThreshold) risk = 'critical';
  else if (predictedMax > warningThreshold) risk = 'warning';

  return {
    currentErrorRate: currentRate,
    predictedMaxRate: predictedMax,
    predictions: forecastResult.predictions,
    risk,
    trend: forecastResult.trend.direction,
    recommendation: risk === 'critical'
      ? 'Immediate investigation required'
      : risk === 'warning'
        ? 'Monitor closely and prepare mitigation'
        : 'System operating normally'
  };
}

/**
 * AI-powered trend analysis
 */
export async function analyzeTrends(data, context = '') {
  const stats = calculateStats(data);
  const trend = detectTrend(data);

  const prompt = `Analyze this time series data and provide insights:

Data points: ${data.slice(-20).join(', ')}${data.length > 20 ? ` (showing last 20 of ${data.length})` : ''}

Statistics:
- Mean: ${stats.mean.toFixed(2)}
- Std Dev: ${stats.stdDev.toFixed(2)}
- Min: ${stats.min}, Max: ${stats.max}
- Trend: ${trend.direction} (slope: ${trend.slope.toFixed(4)})

${context ? `Context: ${context}` : ''}

Provide:
1. Key observations about the data pattern
2. Potential causes for the observed trend
3. Recommended actions
4. Risk assessment`;

  const response = await aiProviders.fastChat(prompt);

  return {
    statistics: stats,
    trend,
    aiAnalysis: response.response,
    dataPoints: data.length
  };
}

// ============================================================================
// SCHEMA FOR PREDICTIONS
// ============================================================================

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS predictions (
        id SERIAL PRIMARY KEY,
        prediction_type VARCHAR(50),
        input_data JSONB,
        predictions JSONB,
        confidence FLOAT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours'
      )
    `);
    schemaReady = true;
  } catch (e) {
    console.error('[Multimodal] Schema error:', e.message);
  }
}

/**
 * Store prediction for later validation
 */
export async function storePrediction(type, inputData, predictions, confidence = 0.7) {
  await ensureSchema();

  const result = await db.query(`
    INSERT INTO predictions (prediction_type, input_data, predictions, confidence)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [type, JSON.stringify(inputData), JSON.stringify(predictions), confidence]);

  return result.rows[0];
}

export default {
  // Vision
  analyzeImage,
  extractText,
  analyzeDocument,

  // Forecasting
  forecast,
  predictCapacity,
  predictFailure,
  analyzeTrends,

  // Storage
  storePrediction
};
