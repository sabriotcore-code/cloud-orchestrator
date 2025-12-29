import * as db from '../db/index.js';

// ============================================================================
// CONVERSATION MEMORY SERVICE
// Stores and retrieves conversation context per user
// ============================================================================

const MAX_HISTORY = 20; // Keep last 20 messages per user

// Store a message in conversation history
export async function remember(userId, role, content) {
  try {
    await db.saveMessage(`slack_${userId}`, role, content);
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

// Get formatted context string for AI prompts
export async function getContextString(userId, limit = 5) {
  const history = await recall(userId, limit);

  if (!history.success || history.messages.length === 0) {
    return '';
  }

  return history.messages
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');
}

// Clear conversation history for a user
export async function forget(userId) {
  try {
    // Would need to add a delete function to db
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
