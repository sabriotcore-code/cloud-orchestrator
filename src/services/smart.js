// ============================================================================
// SMART FEATURES SERVICE
// Voice commands, learning mode, auto-scheduling, and adaptive behavior
// ============================================================================

import fetch from 'node-fetch';
import * as memory from './memory.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const GOOGLE_SPEECH_KEY = process.env.GOOGLE_CLOUD_API_KEY || process.env.GEMINI_API_KEY;
const GOOGLE_TTS_KEY = process.env.GOOGLE_CLOUD_API_KEY || process.env.GEMINI_API_KEY;

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    speechToText: !!GOOGLE_SPEECH_KEY,
    textToSpeech: !!GOOGLE_TTS_KEY,
    learning: true, // Always available (uses memory service)
    scheduler: true,
    analytics: true
  };
}

// ============================================================================
// VOICE COMMANDS - Speech to Text
// ============================================================================

/**
 * Convert speech audio to text using Google Speech-to-Text
 * @param {Buffer} audioBuffer - Audio data (LINEAR16, FLAC, or OGG_OPUS)
 * @param {object} options - Configuration options
 */
export async function speechToText(audioBuffer, options = {}) {
  if (!GOOGLE_SPEECH_KEY) throw new Error('Google Speech API not configured');

  const {
    encoding = 'LINEAR16',
    sampleRateHertz = 16000,
    languageCode = 'en-US'
  } = options;

  const response = await fetch(
    `https://speech.googleapis.com/v1/speech:recognize?key=${GOOGLE_SPEECH_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          encoding,
          sampleRateHertz,
          languageCode,
          enableAutomaticPunctuation: true,
          model: 'command_and_search'
        },
        audio: {
          content: audioBuffer.toString('base64')
        }
      })
    }
  );

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.message);
  }

  const results = data.results || [];
  const transcript = results
    .map(r => r.alternatives?.[0]?.transcript)
    .filter(Boolean)
    .join(' ');

  const confidence = results[0]?.alternatives?.[0]?.confidence || 0;

  return { transcript, confidence };
}

/**
 * Convert text to speech using Google Text-to-Speech
 * @param {string} text - Text to convert
 * @param {object} options - Voice options
 */
export async function textToSpeech(text, options = {}) {
  if (!GOOGLE_TTS_KEY) throw new Error('Google TTS API not configured');

  const {
    languageCode = 'en-US',
    voiceName = 'en-US-Neural2-D',
    speakingRate = 1.0
  } = options;

  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: {
          languageCode,
          name: voiceName
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate
        }
      })
    }
  );

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.message);
  }

  return {
    audioContent: data.audioContent, // Base64 encoded MP3
    audioBuffer: Buffer.from(data.audioContent, 'base64')
  };
}

// ============================================================================
// LEARNING MODE - Preference & Pattern Learning
// ============================================================================

/**
 * Learn a user preference
 * @param {string} userId - User ID
 * @param {string} category - Preference category (e.g., 'response_style', 'repo_default')
 * @param {string} key - Preference key
 * @param {any} value - Preference value
 */
export async function learnPreference(userId, category, key, value) {
  const prefKey = `pref_${userId}_${category}`;
  const existing = await memory.retrieve(prefKey);
  const prefs = existing.value ? JSON.parse(existing.value) : {};

  prefs[key] = value;
  prefs._updatedAt = Date.now();

  await memory.store(prefKey, JSON.stringify(prefs), 'preferences');
  return { learned: true, category, key };
}

/**
 * Get user preferences
 * @param {string} userId - User ID
 * @param {string} category - Optional category filter
 */
export async function getPreferences(userId, category = null) {
  if (category) {
    const prefKey = `pref_${userId}_${category}`;
    const result = await memory.retrieve(prefKey);
    return result.value ? JSON.parse(result.value) : {};
  }

  // Get all categories
  const categories = ['response_style', 'repo_default', 'notification', 'workflow', 'code_style'];
  const allPrefs = {};

  for (const cat of categories) {
    const prefKey = `pref_${userId}_${cat}`;
    const result = await memory.retrieve(prefKey);
    if (result.value) {
      allPrefs[cat] = JSON.parse(result.value);
    }
  }

  return allPrefs;
}

/**
 * Learn from user feedback
 * @param {string} userId - User ID
 * @param {string} action - What the bot did
 * @param {string} feedback - User feedback (positive, negative, correction)
 * @param {object} context - Action context
 */
export async function learnFromFeedback(userId, action, feedback, context = {}) {
  const feedbackKey = `feedback_${userId}`;
  const existing = await memory.retrieve(feedbackKey);
  const history = existing.value ? JSON.parse(existing.value) : [];

  history.push({
    action,
    feedback,
    context,
    timestamp: Date.now()
  });

  // Keep last 100 feedback items
  if (history.length > 100) {
    history.shift();
  }

  await memory.store(feedbackKey, JSON.stringify(history), 'learning');

  // Update preference based on feedback
  if (feedback === 'positive') {
    // Reinforce the action pattern
    await learnPreference(userId, 'patterns', action, { preferred: true, count: 1 });
  } else if (feedback === 'negative') {
    await learnPreference(userId, 'patterns', action, { preferred: false, count: 1 });
  }

  return { recorded: true };
}

/**
 * Detect patterns in user behavior
 * @param {string} userId - User ID
 */
export async function analyzePatterns(userId) {
  const historyKey = `history_${userId}`;
  const history = await memory.retrieve(historyKey);

  if (!history.value) {
    return { patterns: [], suggestions: [] };
  }

  const actions = JSON.parse(history.value);
  const patterns = {};
  const timePatterns = {};

  for (const action of actions) {
    // Count action frequency
    patterns[action.type] = (patterns[action.type] || 0) + 1;

    // Analyze time patterns
    const hour = new Date(action.timestamp).getHours();
    timePatterns[hour] = (timePatterns[hour] || 0) + 1;
  }

  // Find peak activity hours
  const peakHours = Object.entries(timePatterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([hour]) => parseInt(hour));

  // Generate suggestions
  const suggestions = [];

  // Most common actions
  const topActions = Object.entries(patterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  for (const [action, count] of topActions) {
    if (count > 5) {
      suggestions.push({
        type: 'shortcut',
        action,
        message: `You use "${action}" frequently. Want me to create a shortcut?`
      });
    }
  }

  return {
    patterns: Object.entries(patterns).map(([action, count]) => ({ action, count })),
    peakHours,
    suggestions
  };
}

/**
 * Record a user action for learning
 * @param {string} userId - User ID
 * @param {string} type - Action type
 * @param {object} data - Action data
 */
export async function recordAction(userId, type, data = {}) {
  const historyKey = `history_${userId}`;
  const existing = await memory.retrieve(historyKey);
  const history = existing.value ? JSON.parse(existing.value) : [];

  history.push({
    type,
    data,
    timestamp: Date.now()
  });

  // Keep last 500 actions
  if (history.length > 500) {
    history.shift();
  }

  await memory.store(historyKey, JSON.stringify(history), 'history');
  return { recorded: true };
}

// ============================================================================
// AUTO-SCHEDULER - Smart Task Scheduling
// ============================================================================

const scheduledTasks = new Map();
let schedulerInterval = null;

/**
 * Schedule a recurring task
 * @param {string} taskId - Unique task ID
 * @param {string} schedule - Cron-like schedule (e.g., '5m', '1h', '24h', '0 9 * * *')
 * @param {Function} handler - Task handler function
 * @param {object} options - Task options
 */
export function scheduleTask(taskId, schedule, handler, options = {}) {
  // Parse simple intervals
  let intervalMs;
  const simpleMatch = schedule.match(/^(\d+)(m|h|d)$/);

  if (simpleMatch) {
    const [, value, unit] = simpleMatch;
    const multipliers = { m: 60000, h: 3600000, d: 86400000 };
    intervalMs = parseInt(value) * multipliers[unit];
  } else {
    // Default to hourly
    intervalMs = 3600000;
  }

  const task = {
    id: taskId,
    schedule,
    intervalMs,
    handler,
    lastRun: null,
    nextRun: Date.now() + intervalMs,
    runCount: 0,
    errors: [],
    enabled: true,
    ...options
  };

  scheduledTasks.set(taskId, task);
  ensureSchedulerRunning();

  return { scheduled: true, taskId, nextRun: new Date(task.nextRun).toISOString() };
}

/**
 * Cancel a scheduled task
 * @param {string} taskId - Task ID to cancel
 */
export function cancelTask(taskId) {
  const deleted = scheduledTasks.delete(taskId);
  return { cancelled: deleted, taskId };
}

/**
 * List all scheduled tasks
 */
export function listScheduledTasks() {
  return Array.from(scheduledTasks.values()).map(t => ({
    id: t.id,
    schedule: t.schedule,
    lastRun: t.lastRun ? new Date(t.lastRun).toISOString() : null,
    nextRun: new Date(t.nextRun).toISOString(),
    runCount: t.runCount,
    enabled: t.enabled,
    errorCount: t.errors.length
  }));
}

/**
 * Toggle a task on/off
 * @param {string} taskId - Task ID
 * @param {boolean} enabled - Enable or disable
 */
export function toggleTask(taskId, enabled) {
  const task = scheduledTasks.get(taskId);
  if (task) {
    task.enabled = enabled;
    return { toggled: true, taskId, enabled };
  }
  return { toggled: false, taskId };
}

function ensureSchedulerRunning() {
  if (schedulerInterval) return;

  schedulerInterval = setInterval(async () => {
    const now = Date.now();

    for (const [taskId, task] of scheduledTasks) {
      if (!task.enabled) continue;
      if (now < task.nextRun) continue;

      try {
        task.lastRun = now;
        task.runCount++;
        task.nextRun = now + task.intervalMs;

        await task.handler();
      } catch (error) {
        task.errors.push({
          time: now,
          message: error.message
        });

        // Keep only last 10 errors
        if (task.errors.length > 10) {
          task.errors.shift();
        }

        console.error(`[Scheduler] Task ${taskId} failed:`, error.message);
      }
    }
  }, 10000); // Check every 10 seconds
}

// ============================================================================
// ANALYTICS - Usage and Performance Tracking
// ============================================================================

const analytics = {
  commands: {},
  responses: [],
  errors: [],
  latencies: []
};

/**
 * Track a command execution
 * @param {string} command - Command name
 * @param {number} latencyMs - Execution time
 * @param {boolean} success - Whether it succeeded
 * @param {object} metadata - Additional data
 */
export function trackCommand(command, latencyMs, success, metadata = {}) {
  // Increment command counter
  analytics.commands[command] = (analytics.commands[command] || 0) + 1;

  // Track latency
  analytics.latencies.push({
    command,
    latencyMs,
    timestamp: Date.now()
  });

  // Keep last 1000 latencies
  if (analytics.latencies.length > 1000) {
    analytics.latencies.shift();
  }

  // Track errors
  if (!success) {
    analytics.errors.push({
      command,
      error: metadata.error,
      timestamp: Date.now()
    });

    if (analytics.errors.length > 100) {
      analytics.errors.shift();
    }
  }
}

/**
 * Get analytics summary
 */
export function getAnalytics() {
  // Calculate averages
  const recentLatencies = analytics.latencies.slice(-100);
  const avgLatency = recentLatencies.length > 0
    ? recentLatencies.reduce((sum, l) => sum + l.latencyMs, 0) / recentLatencies.length
    : 0;

  // Sort commands by frequency
  const topCommands = Object.entries(analytics.commands)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([command, count]) => ({ command, count }));

  // Calculate error rate
  const totalCommands = Object.values(analytics.commands).reduce((a, b) => a + b, 0);
  const errorRate = totalCommands > 0
    ? (analytics.errors.length / totalCommands) * 100
    : 0;

  return {
    totalCommands,
    topCommands,
    avgLatencyMs: Math.round(avgLatency),
    errorRate: errorRate.toFixed(2) + '%',
    recentErrors: analytics.errors.slice(-5)
  };
}

/**
 * Reset analytics
 */
export function resetAnalytics() {
  analytics.commands = {};
  analytics.responses = [];
  analytics.errors = [];
  analytics.latencies = [];
  return { reset: true };
}

// ============================================================================
// SMART SUGGESTIONS - Proactive Recommendations
// ============================================================================

/**
 * Get smart suggestions based on context
 * @param {string} userId - User ID
 * @param {object} context - Current context (time, recent actions, etc.)
 */
export async function getSuggestions(userId, context = {}) {
  const suggestions = [];

  // Get user patterns
  const patterns = await analyzePatterns(userId);

  // Time-based suggestions
  const hour = new Date().getHours();
  if (hour === 9) {
    suggestions.push({
      type: 'morning_standup',
      message: 'Good morning! Want me to summarize overnight activity?'
    });
  }

  if (hour === 17) {
    suggestions.push({
      type: 'end_of_day',
      message: 'End of day - want me to create a summary of today\'s work?'
    });
  }

  // Pattern-based suggestions
  suggestions.push(...patterns.suggestions);

  // Context-based suggestions
  if (context.lastError) {
    suggestions.push({
      type: 'error_help',
      message: `I noticed an error earlier. Want me to investigate "${context.lastError}"?`
    });
  }

  if (context.pendingPR) {
    suggestions.push({
      type: 'pr_reminder',
      message: `You have a pending PR. Want me to check its status?`
    });
  }

  return suggestions;
}

// ============================================================================
// ADAPTIVE RESPONSE STYLE
// ============================================================================

/**
 * Adapt response based on user preferences
 * @param {string} userId - User ID
 * @param {string} response - Original response
 */
export async function adaptResponse(userId, response) {
  const prefs = await getPreferences(userId, 'response_style');

  // Default preferences
  const style = {
    verbose: prefs.verbose ?? true,
    codeBlocks: prefs.codeBlocks ?? true,
    emojis: prefs.emojis ?? true,
    technicalLevel: prefs.technicalLevel ?? 'developer'
  };

  let adapted = response;

  // Adjust verbosity
  if (!style.verbose && adapted.length > 500) {
    // Truncate to key points
    const sentences = adapted.split(/[.!?]+/);
    adapted = sentences.slice(0, 3).join('. ') + '.';
    adapted += '\n\n_Use "verbose on" for detailed responses._';
  }

  // Remove emojis if disabled
  if (!style.emojis) {
    adapted = adapted.replace(/[\u{1F300}-\u{1F9FF}]/gu, '');
  }

  return adapted;
}

// ============================================================================
// CLEANUP
// ============================================================================

export function shutdown() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  scheduledTasks.clear();
}

export default {
  getStatus,
  // Voice
  speechToText,
  textToSpeech,
  // Learning
  learnPreference,
  getPreferences,
  learnFromFeedback,
  analyzePatterns,
  recordAction,
  // Scheduler
  scheduleTask,
  cancelTask,
  listScheduledTasks,
  toggleTask,
  // Analytics
  trackCommand,
  getAnalytics,
  resetAnalytics,
  // Smart features
  getSuggestions,
  adaptResponse,
  shutdown
};
