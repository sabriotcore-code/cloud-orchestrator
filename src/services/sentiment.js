/**
 * SENTIMENT ANALYSIS LAYER
 *
 * Emotional intelligence for the orchestrator:
 * - Text sentiment analysis
 * - Emotion detection
 * - Urgency classification
 * - User mood tracking
 * - Adaptive response tuning
 */

import * as db from '../db/index.js';
import * as aiProviders from './ai-providers.js';
import * as neo4j from './neo4j.js';

// ============================================================================
// SENTIMENT ANALYSIS
// ============================================================================

/**
 * Analyze sentiment of text
 */
export async function analyzeSentiment(text) {
  // Handle missing or invalid text
  if (!text || typeof text !== 'string') {
    return {
      text: '',
      sentiment: 'neutral',
      score: 0,
      confidence: 0,
      emotions: [],
      urgency: 'low',
      method: 'fallback',
      error: 'No text provided'
    };
  }

  // Quick rule-based pre-check for obvious cases
  const quickResult = quickSentimentCheck(text);
  if (quickResult.confidence > 0.9) {
    return quickResult;
  }

  // AI-powered analysis for nuanced cases
  const prompt = `Analyze the sentiment of this text. Return JSON only:

Text: "${text.substring(0, 500)}"

{
  "sentiment": "positive|negative|neutral|mixed",
  "score": <-1.0 to 1.0>,
  "confidence": <0.0 to 1.0>,
  "emotions": ["emotion1", "emotion2"],
  "urgency": "low|medium|high|critical",
  "key_phrases": ["phrase1", "phrase2"]
}`;

  try {
    const response = await aiProviders.fastChat(prompt);

    // Handle AI error response
    if (response?.error) {
      console.log('[Sentiment] AI returned error, using rule-based:', response.error);
      return quickResult;
    }

    // Extract text from response
    const responseText = typeof response?.response === 'string' ? response.response : '';
    const match = responseText.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : {};

    return {
      text: text.substring(0, 100),
      ...parsed,
      method: 'ai'
    };
  } catch (e) {
    console.error('[Sentiment] AI analysis failed:', e.message);
    return quickResult; // Fallback to rule-based
  }
}

/**
 * Quick rule-based sentiment check
 */
function quickSentimentCheck(text) {
  const lower = text.toLowerCase();

  const positiveWords = ['thanks', 'great', 'excellent', 'love', 'perfect', 'awesome', 'good', 'nice', 'helpful', 'amazing'];
  const negativeWords = ['error', 'fail', 'wrong', 'bad', 'hate', 'terrible', 'broken', 'issue', 'problem', 'urgent', 'critical', 'asap'];
  const urgentWords = ['urgent', 'asap', 'immediately', 'critical', 'emergency', 'now', 'hurry'];

  let positiveCount = 0;
  let negativeCount = 0;
  let urgentCount = 0;

  positiveWords.forEach(w => { if (lower.includes(w)) positiveCount++; });
  negativeWords.forEach(w => { if (lower.includes(w)) negativeCount++; });
  urgentWords.forEach(w => { if (lower.includes(w)) urgentCount++; });

  const score = (positiveCount - negativeCount) / Math.max(positiveCount + negativeCount, 1);
  const sentiment = score > 0.3 ? 'positive' : score < -0.3 ? 'negative' : 'neutral';

  let urgency = 'low';
  if (urgentCount >= 2 || lower.includes('!!!')) urgency = 'critical';
  else if (urgentCount >= 1) urgency = 'high';
  else if (negativeCount >= 2) urgency = 'medium';

  return {
    sentiment,
    score,
    confidence: Math.abs(score) > 0.5 ? 0.8 : 0.6,
    urgency,
    emotions: sentiment === 'positive' ? ['satisfaction'] : sentiment === 'negative' ? ['frustration'] : ['neutral'],
    method: 'rule-based'
  };
}

// ============================================================================
// EMOTION DETECTION
// ============================================================================

/**
 * Detect specific emotions in text
 */
export async function detectEmotions(text) {
  if (!text || typeof text !== 'string') {
    return { text: '', emotions: [], dominantEmotion: null, error: 'No text provided' };
  }

  const prompt = `Detect emotions in this text. Return JSON array of emotions with intensities:

Text: "${text.substring(0, 500)}"

Return format: [{"emotion": "name", "intensity": 0.0-1.0, "trigger": "what caused it"}]

Possible emotions: joy, sadness, anger, fear, surprise, disgust, trust, anticipation, frustration, confusion, satisfaction, anxiety`;

  try {
    const response = await aiProviders.fastChat(prompt);

    // Handle AI error response
    if (response?.error) {
      return { text: text.substring(0, 100), emotions: [], error: response.error };
    }

    // Extract text from response
    const responseText = typeof response?.response === 'string' ? response.response : '';
    const match = responseText.match(/\[[\s\S]*\]/);
    const emotions = match ? JSON.parse(match[0]) : [];

    return {
      text: text.substring(0, 100),
      emotions,
      dominantEmotion: emotions.sort((a, b) => b.intensity - a.intensity)[0] || null
    };
  } catch (e) {
    console.error('[Sentiment] Emotion detection failed:', e.message);
    return {
      text: text.substring(0, 100),
      emotions: [],
      error: e.message
    };
  }
}

// ============================================================================
// USER MOOD TRACKING
// ============================================================================

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_mood_history (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100),
        sentiment VARCHAR(20),
        score FLOAT,
        emotions TEXT[],
        urgency VARCHAR(20),
        context TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await db.query(`CREATE INDEX IF NOT EXISTS idx_mood_user ON user_mood_history(user_id, created_at DESC)`);

    schemaReady = true;
  } catch (e) {
    console.error('[Sentiment] Schema error:', e.message);
  }
}

/**
 * Track user mood over time
 */
export async function trackMood(userId, text, context = null) {
  await ensureSchema();

  const analysis = await analyzeSentiment(text);

  await db.query(`
    INSERT INTO user_mood_history (user_id, sentiment, score, emotions, urgency, context)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [userId, analysis.sentiment, analysis.score, analysis.emotions, analysis.urgency, context]);

  // Store in Neo4j for relationship tracking
  try {
    await neo4j.createEntity('MoodEvent', {
      userId,
      sentiment: analysis.sentiment,
      score: analysis.score,
      urgency: analysis.urgency,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    // Neo4j optional
  }

  return analysis;
}

/**
 * Get user mood trend
 */
export async function getMoodTrend(userId, hours = 24) {
  await ensureSchema();

  const result = await db.query(`
    SELECT sentiment, score, urgency, created_at
    FROM user_mood_history
    WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour' * $2
    ORDER BY created_at ASC
  `, [userId, hours]);

  if (result.rows.length === 0) {
    return { userId, trend: 'unknown', dataPoints: 0 };
  }

  const scores = result.rows.map(r => r.score);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

  // Calculate trend
  let trend = 'stable';
  if (scores.length >= 3) {
    const firstHalf = scores.slice(0, Math.floor(scores.length / 2));
    const secondHalf = scores.slice(Math.floor(scores.length / 2));
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    if (secondAvg - firstAvg > 0.2) trend = 'improving';
    else if (firstAvg - secondAvg > 0.2) trend = 'declining';
  }

  // Count urgencies
  const urgencyCounts = {};
  result.rows.forEach(r => {
    urgencyCounts[r.urgency] = (urgencyCounts[r.urgency] || 0) + 1;
  });

  return {
    userId,
    trend,
    averageScore: avgScore,
    currentSentiment: result.rows[result.rows.length - 1].sentiment,
    dataPoints: result.rows.length,
    urgencyCounts,
    timespan: `${hours} hours`
  };
}

// ============================================================================
// ADAPTIVE RESPONSE
// ============================================================================

/**
 * Get response style recommendation based on user mood
 */
export async function getResponseStyle(userId) {
  const trend = await getMoodTrend(userId, 4); // Last 4 hours

  let style = {
    tone: 'professional',
    verbosity: 'normal',
    empathy: 'moderate',
    urgencyHandling: 'standard'
  };

  if (trend.currentSentiment === 'negative' || trend.trend === 'declining') {
    style.tone = 'supportive';
    style.empathy = 'high';
    style.verbosity = 'concise'; // Don't overwhelm frustrated users
  }

  if (trend.urgencyCounts?.critical > 0 || trend.urgencyCounts?.high > 1) {
    style.urgencyHandling = 'priority';
    style.verbosity = 'minimal';
  }

  if (trend.currentSentiment === 'positive' && trend.trend === 'improving') {
    style.tone = 'friendly';
    style.empathy = 'moderate';
  }

  return {
    userId,
    style,
    basedOn: trend
  };
}

/**
 * Adjust response based on sentiment
 */
export async function adjustResponse(response, userId) {
  const styleRec = await getResponseStyle(userId);

  if (styleRec.style.tone === 'supportive') {
    // Add empathetic prefix for frustrated users
    if (!response.startsWith('I understand') && !response.startsWith('I see')) {
      response = `I understand. ${response}`;
    }
  }

  if (styleRec.style.urgencyHandling === 'priority') {
    // Add urgency acknowledgment
    if (!response.includes('priority') && !response.includes('right away')) {
      response = `Handling this as a priority. ${response}`;
    }
  }

  return {
    originalResponse: response,
    adjustedResponse: response,
    styleApplied: styleRec.style
  };
}

// ============================================================================
// BATCH ANALYSIS
// ============================================================================

/**
 * Analyze sentiment of multiple texts
 */
export async function batchAnalyze(texts) {
  const results = await Promise.all(
    texts.map(text => analyzeSentiment(text))
  );

  const summary = {
    total: texts.length,
    positive: results.filter(r => r.sentiment === 'positive').length,
    negative: results.filter(r => r.sentiment === 'negative').length,
    neutral: results.filter(r => r.sentiment === 'neutral').length,
    averageScore: results.reduce((sum, r) => sum + (r.score || 0), 0) / results.length,
    urgentCount: results.filter(r => r.urgency === 'critical' || r.urgency === 'high').length
  };

  return {
    results,
    summary
  };
}

/**
 * Analyze conversation sentiment over time
 */
export async function analyzeConversation(messages) {
  const analyses = await batchAnalyze(messages.map(m => m.content || m));

  // Find sentiment shifts
  const shifts = [];
  for (let i = 1; i < analyses.results.length; i++) {
    const prev = analyses.results[i - 1];
    const curr = analyses.results[i];

    if (prev.sentiment !== curr.sentiment) {
      shifts.push({
        index: i,
        from: prev.sentiment,
        to: curr.sentiment,
        scoreDelta: (curr.score || 0) - (prev.score || 0)
      });
    }
  }

  return {
    ...analyses,
    sentimentShifts: shifts,
    overallTrend: analyses.summary.averageScore > 0.2 ? 'positive'
      : analyses.summary.averageScore < -0.2 ? 'negative'
        : 'neutral'
  };
}

export default {
  // Core analysis
  analyzeSentiment,
  detectEmotions,

  // Tracking
  trackMood,
  getMoodTrend,

  // Adaptive response
  getResponseStyle,
  adjustResponse,

  // Batch
  batchAnalyze,
  analyzeConversation
};
