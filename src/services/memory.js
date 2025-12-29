import * as db from '../db/index.js';

// ============================================================================
// ENHANCED CONVERSATION MEMORY SERVICE
// Stores, retrieves, and summarizes conversation context per user
// ============================================================================

const MAX_HISTORY = 50; // Keep last 50 messages per user
const SUMMARY_THRESHOLD = 20; // Summarize when we hit this many messages

// Store a message in conversation history
export async function remember(userId, role, content) {
  try {
    await db.saveMessage(`slack_${userId}`, role, content);

    // Check if we need to summarize old messages
    const history = await recall(userId, SUMMARY_THRESHOLD + 5);
    if (history.count > SUMMARY_THRESHOLD) {
      // Trigger async summarization (don't await)
      summarizeOldMessages(userId).catch(e =>
        console.log('[Memory] Summarization failed:', e.message)
      );
    }

    return { success: true };
  } catch (error) {
    console.error('[Memory] Error saving:', error);
    return { success: false, error: error.message };
  }
}

// Get recent conversation history for a user
export async function recall(userId, limit = 10) {
  try {
    const messages = await db.getRecentContext(`slack_${userId}`, limit);
    return {
      success: true,
      messages,
      count: messages.length
    };
  } catch (error) {
    console.error('[Memory] Error recalling:', error);
    return { success: false, messages: [], error: error.message };
  }
}

// Get formatted context string for AI prompts - ENHANCED with summary
export async function getContextString(userId, limit = 10) {
  const history = await recall(userId, limit);

  if (!history.success || history.messages.length === 0) {
    // Try to get saved summary instead
    const summary = await retrieve(`summary_${userId}`);
    return summary.value || '';
  }

  // Include any saved summary for older context
  const summary = await retrieve(`summary_${userId}`);
  const summaryPrefix = summary.value ? `[Previous context: ${summary.value}]\n\n` : '';

  return summaryPrefix + history.messages
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');
}

// Summarize old messages to compress context
async function summarizeOldMessages(userId) {
  try {
    const history = await recall(userId, 30);
    if (!history.success || history.messages.length < 15) return;

    // Get older messages (not the most recent 10)
    const olderMessages = history.messages.slice(10);

    // Create a summary
    const summaryText = olderMessages
      .map(m => `${m.role}: ${m.content.substring(0, 100)}`)
      .join('\n');

    // Store the summary
    const existingSummary = await retrieve(`summary_${userId}`);
    const newSummary = existingSummary.value
      ? `${existingSummary.value}\n\nMore recent: ${summaryText.substring(0, 500)}`
      : summaryText.substring(0, 1000);

    await store(`summary_${userId}`, newSummary.substring(0, 2000), 'summaries');
    console.log(`[Memory] Summarized ${olderMessages.length} messages for ${userId}`);
  } catch (error) {
    console.error('[Memory] Summarization error:', error);
  }
}

// Clear conversation history for a user
export async function forget(userId) {
  try {
    await store(`summary_${userId}`, '', 'summaries');
    return { success: true, message: 'Conversation cleared' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Store a key-value memory
export async function store(key, value, category = 'general') {
  try {
    await db.setMemory(key, value, category);
    return { success: true, key };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Retrieve a key-value memory
export async function retrieve(key) {
  try {
    const value = await db.getMemory(key);
    return { success: true, key, value };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Get all memories in a category
export async function retrieveCategory(category) {
  try {
    const values = await db.getMemoryByCategory(category);
    return { success: true, category, values };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// USER PREFERENCES (#11)
// ============================================================================

// Store user preference
export async function setPreference(userId, key, value) {
  try {
    await store(`pref_${userId}_${key}`, value, 'preferences');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Get user preference
export async function getPreference(userId, key) {
  try {
    const result = await retrieve(`pref_${userId}_${key}`);
    return result.value || null;
  } catch (error) {
    return null;
  }
}

// Get all user preferences
export async function getAllPreferences(userId) {
  try {
    const all = await retrieveCategory('preferences');
    const userPrefs = {};
    if (all.values) {
      for (const [k, v] of Object.entries(all.values)) {
        if (k.startsWith(`pref_${userId}_`)) {
          const prefKey = k.replace(`pref_${userId}_`, '');
          userPrefs[prefKey] = v;
        }
      }
    }
    return userPrefs;
  } catch (error) {
    return {};
  }
}

// Learn from user interaction (auto-detect preferences)
export async function learnFromInteraction(userId, interaction) {
  try {
    // Detect coding style preferences
    if (interaction.includes('ES modules') || interaction.includes('import/export')) {
      await setPreference(userId, 'moduleStyle', 'esm');
    }
    if (interaction.includes('CommonJS') || interaction.includes('require(')) {
      await setPreference(userId, 'moduleStyle', 'commonjs');
    }

    // Detect response preferences
    if (interaction.includes('brief') || interaction.includes('concise') || interaction.includes('short')) {
      await setPreference(userId, 'responseStyle', 'concise');
    }
    if (interaction.includes('detailed') || interaction.includes('explain')) {
      await setPreference(userId, 'responseStyle', 'detailed');
    }

    return { success: true };
  } catch (error) {
    return { success: false };
  }
}
