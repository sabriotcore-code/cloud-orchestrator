/**
 * SMART CONTEXT MEMORY ARCHITECTURE
 *
 * Multi-tier memory system with intelligent retrieval:
 * - Working Memory: Current conversation context (fast, limited)
 * - Short-term Memory: Recent interactions (hours)
 * - Long-term Memory: Persistent knowledge (days/weeks)
 * - Semantic Memory: Vector-indexed for similarity search
 */

import * as db from '../db/index.js';

// ============================================================================
// SCHEMA SETUP
// ============================================================================

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;

  try {
    // Working memory - current session context
    await db.query(`
      CREATE TABLE IF NOT EXISTS working_memory (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(100) NOT NULL,
        context_type VARCHAR(50), -- conversation, task, file, code
        content TEXT,
        relevance_score FLOAT DEFAULT 1.0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '2 hours'
      )
    `);

    // Short-term memory - recent important items
    await db.query(`
      CREATE TABLE IF NOT EXISTS short_term_memory (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100),
        memory_type VARCHAR(50), -- fact, preference, decision, outcome
        content TEXT,
        context TEXT,
        importance FLOAT DEFAULT 0.5,
        access_count INTEGER DEFAULT 0,
        last_accessed TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours'
      )
    `);

    // Long-term memory - consolidated knowledge
    await db.query(`
      CREATE TABLE IF NOT EXISTS long_term_memory (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100),
        category VARCHAR(50), -- user_pref, domain_knowledge, learned_pattern
        key VARCHAR(200),
        value TEXT,
        confidence FLOAT DEFAULT 0.5,
        times_reinforced INTEGER DEFAULT 1,
        source TEXT, -- where this knowledge came from
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Context summaries - compressed conversation history
    await db.query(`
      CREATE TABLE IF NOT EXISTS context_summaries (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(100),
        summary TEXT,
        key_points TEXT[], -- extracted key points
        entities TEXT[], -- mentioned entities (people, files, projects)
        sentiment VARCHAR(20),
        message_count INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Indexes
    await db.query(`CREATE INDEX IF NOT EXISTS idx_working_session ON working_memory(session_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_short_term_user ON short_term_memory(user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_long_term_key ON long_term_memory(user_id, category, key)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_summaries_session ON context_summaries(session_id)`);

    schemaReady = true;
    console.log('[ContextMemory] Schema ready');
  } catch (err) {
    console.error('[ContextMemory] Schema setup error:', err.message);
  }
}

// ============================================================================
// WORKING MEMORY - Current Session Context
// ============================================================================

/**
 * Add item to working memory
 */
export async function addToWorkingMemory(sessionId, contextType, content, relevance = 1.0) {
  await ensureSchema();

  const result = await db.query(`
    INSERT INTO working_memory (session_id, context_type, content, relevance_score)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [sessionId, contextType, content, relevance]);

  // Cleanup expired items
  await db.query(`DELETE FROM working_memory WHERE expires_at < NOW()`);

  return result.rows[0];
}

/**
 * Get current working memory for session
 */
export async function getWorkingMemory(sessionId, limit = 20) {
  await ensureSchema();

  const result = await db.query(`
    SELECT * FROM working_memory
    WHERE session_id = $1 AND expires_at > NOW()
    ORDER BY relevance_score DESC, created_at DESC
    LIMIT $2
  `, [sessionId, limit]);

  return result.rows;
}

/**
 * Update relevance scores based on usage
 */
export async function boostRelevance(memoryId, boost = 0.1) {
  await db.query(`
    UPDATE working_memory
    SET relevance_score = LEAST(relevance_score + $2, 1.0)
    WHERE id = $1
  `, [memoryId, boost]);
}

// ============================================================================
// SHORT-TERM MEMORY - Recent Interactions
// ============================================================================

/**
 * Store short-term memory item
 */
export async function storeShortTerm(userId, memoryType, content, context = null, importance = 0.5) {
  await ensureSchema();

  const result = await db.query(`
    INSERT INTO short_term_memory (user_id, memory_type, content, context, importance)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [userId, memoryType, content, context, importance]);

  // Cleanup old items
  await db.query(`DELETE FROM short_term_memory WHERE expires_at < NOW()`);

  return result.rows[0];
}

/**
 * Retrieve relevant short-term memories
 */
export async function getShortTermMemories(userId, memoryType = null, limit = 10) {
  await ensureSchema();

  let query = `
    SELECT * FROM short_term_memory
    WHERE user_id = $1 AND expires_at > NOW()
  `;
  const params = [userId];

  if (memoryType) {
    query += ` AND memory_type = $2`;
    params.push(memoryType);
  }

  query += ` ORDER BY importance DESC, last_accessed DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await db.query(query, params);

  // Update access counts
  if (result.rows.length > 0) {
    const ids = result.rows.map(r => r.id);
    await db.query(`
      UPDATE short_term_memory
      SET access_count = access_count + 1, last_accessed = NOW()
      WHERE id = ANY($1)
    `, [ids]);
  }

  return result.rows;
}

/**
 * Search short-term memory by content
 */
export async function searchShortTerm(userId, searchText, limit = 5) {
  await ensureSchema();

  const result = await db.query(`
    SELECT * FROM short_term_memory
    WHERE user_id = $1
      AND expires_at > NOW()
      AND (content ILIKE $2 OR context ILIKE $2)
    ORDER BY importance DESC
    LIMIT $3
  `, [userId, `%${searchText}%`, limit]);

  return result.rows;
}

// ============================================================================
// LONG-TERM MEMORY - Persistent Knowledge
// ============================================================================

/**
 * Store or update long-term knowledge
 */
export async function storeLongTerm(userId, category, key, value, source = null) {
  await ensureSchema();

  const result = await db.query(`
    INSERT INTO long_term_memory (user_id, category, key, value, source)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id, category, key)
    DO UPDATE SET
      value = $4,
      times_reinforced = long_term_memory.times_reinforced + 1,
      confidence = LEAST(long_term_memory.confidence + 0.1, 1.0),
      updated_at = NOW()
    RETURNING *
  `, [userId, category, key, value, source]);

  return result.rows[0];
}

/**
 * Get long-term knowledge by category
 */
export async function getLongTermByCategory(userId, category) {
  await ensureSchema();

  const result = await db.query(`
    SELECT * FROM long_term_memory
    WHERE user_id = $1 AND category = $2
    ORDER BY confidence DESC, times_reinforced DESC
  `, [userId, category]);

  return result.rows;
}

/**
 * Get specific long-term memory
 */
export async function getLongTerm(userId, category, key) {
  await ensureSchema();

  const result = await db.query(`
    SELECT * FROM long_term_memory
    WHERE user_id = $1 AND category = $2 AND key = $3
  `, [userId, category, key]);

  return result.rows[0];
}

/**
 * Get all user preferences
 */
export async function getUserPreferences(userId) {
  return getLongTermByCategory(userId, 'user_pref');
}

// ============================================================================
// CONTEXT SUMMARIZATION
// ============================================================================

/**
 * Create summary of conversation segment
 */
export async function createContextSummary(sessionId, messages) {
  await ensureSchema();

  // Extract key information
  const keyPoints = extractKeyPoints(messages);
  const entities = extractEntities(messages);
  const sentiment = analyzeSentiment(messages);

  const summary = generateSummary(messages, keyPoints);

  const result = await db.query(`
    INSERT INTO context_summaries (session_id, summary, key_points, entities, sentiment, message_count)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [sessionId, summary, keyPoints, entities, sentiment, messages.length]);

  return result.rows[0];
}

/**
 * Get summaries for session
 */
export async function getContextSummaries(sessionId, limit = 5) {
  await ensureSchema();

  const result = await db.query(`
    SELECT * FROM context_summaries
    WHERE session_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `, [sessionId, limit]);

  return result.rows;
}

/**
 * Extract key points from messages
 */
function extractKeyPoints(messages) {
  const points = [];
  const patterns = [
    /(?:need to|must|should|have to|want to)\s+([^.!?]+)/gi,
    /(?:important|critical|key|essential):\s*([^.!?]+)/gi,
    /(?:decision|decided|chose|selected):\s*([^.!?]+)/gi,
    /(?:error|bug|issue|problem):\s*([^.!?]+)/gi,
  ];

  for (const msg of messages) {
    const content = msg.content || '';
    for (const pattern of patterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        points.push(match[1].trim().substring(0, 200));
      }
    }
  }

  return [...new Set(points)].slice(0, 10);
}

/**
 * Extract entities (people, files, projects) from messages
 */
function extractEntities(messages) {
  const entities = new Set();

  for (const msg of messages) {
    const content = msg.content || '';

    // File paths
    const files = content.match(/[A-Za-z]:\\[^\s"']+|\/[^\s"']+\.[a-z]+/g) || [];
    files.forEach(f => entities.add(`file:${f}`));

    // Email addresses
    const emails = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    emails.forEach(e => entities.add(`email:${e}`));

    // URLs
    const urls = content.match(/https?:\/\/[^\s"']+/g) || [];
    urls.forEach(u => entities.add(`url:${u}`));

    // @mentions
    const mentions = content.match(/@[a-zA-Z0-9_]+/g) || [];
    mentions.forEach(m => entities.add(`mention:${m}`));

    // Project names (common patterns)
    const projects = content.match(/(?:rei-dashboard|cloud-orchestrator|rei-api|pinecone-context)/gi) || [];
    projects.forEach(p => entities.add(`project:${p.toLowerCase()}`));
  }

  return [...entities].slice(0, 20);
}

/**
 * Simple sentiment analysis
 */
function analyzeSentiment(messages) {
  const text = messages.map(m => m.content || '').join(' ').toLowerCase();

  const positive = ['good', 'great', 'excellent', 'perfect', 'thanks', 'awesome', 'nice', 'success'];
  const negative = ['bad', 'error', 'fail', 'wrong', 'issue', 'problem', 'bug', 'broken'];

  let score = 0;
  positive.forEach(w => { if (text.includes(w)) score++; });
  negative.forEach(w => { if (text.includes(w)) score--; });

  if (score > 2) return 'positive';
  if (score < -2) return 'negative';
  return 'neutral';
}

/**
 * Generate summary from messages
 */
function generateSummary(messages, keyPoints) {
  const userMessages = messages.filter(m => m.role === 'user');
  const topics = keyPoints.slice(0, 3).join('; ');

  if (userMessages.length === 0) {
    return 'No user messages in this segment.';
  }

  const firstRequest = userMessages[0].content?.substring(0, 200) || '';
  return `User requested: ${firstRequest}... Key topics: ${topics || 'general discussion'}`;
}

// ============================================================================
// MEMORY CONSOLIDATION
// ============================================================================

/**
 * Consolidate important short-term memories to long-term
 */
export async function consolidateMemories(userId) {
  await ensureSchema();

  // Find high-importance, frequently accessed short-term memories
  const candidates = await db.query(`
    SELECT * FROM short_term_memory
    WHERE user_id = $1
      AND importance >= 0.7
      AND access_count >= 3
    ORDER BY importance DESC
    LIMIT 20
  `, [userId]);

  let consolidated = 0;

  for (const memory of candidates.rows) {
    // Determine category based on type
    let category = 'domain_knowledge';
    if (memory.memory_type === 'preference') category = 'user_pref';
    if (memory.memory_type === 'pattern') category = 'learned_pattern';

    // Create key from content hash
    const key = memory.content.substring(0, 100).replace(/[^a-zA-Z0-9]/g, '_');

    await storeLongTerm(userId, category, key, memory.content, 'consolidated_from_short_term');
    consolidated++;
  }

  console.log(`[ContextMemory] Consolidated ${consolidated} memories for user ${userId}`);
  return consolidated;
}

/**
 * Decay old memories (reduce importance over time)
 */
export async function decayMemories() {
  await ensureSchema();

  // Decay short-term memories not accessed recently
  await db.query(`
    UPDATE short_term_memory
    SET importance = importance * 0.9
    WHERE last_accessed < NOW() - INTERVAL '6 hours'
      AND importance > 0.1
  `);

  // Decay long-term memories not reinforced
  await db.query(`
    UPDATE long_term_memory
    SET confidence = confidence * 0.95
    WHERE updated_at < NOW() - INTERVAL '7 days'
      AND confidence > 0.2
  `);

  console.log('[ContextMemory] Memory decay applied');
}

// ============================================================================
// INTELLIGENT RETRIEVAL
// ============================================================================

/**
 * Get relevant context for a query
 */
export async function getRelevantContext(userId, sessionId, query, limit = 10) {
  await ensureSchema();

  const context = {
    working: [],
    shortTerm: [],
    longTerm: [],
    summaries: []
  };

  // Working memory (current session)
  if (sessionId) {
    context.working = await getWorkingMemory(sessionId, 5);
  }

  // Search short-term memory
  if (query) {
    context.shortTerm = await searchShortTerm(userId, query, 5);
  } else {
    context.shortTerm = await getShortTermMemories(userId, null, 5);
  }

  // Get user preferences
  context.longTerm = await getUserPreferences(userId);

  // Recent summaries
  if (sessionId) {
    context.summaries = await getContextSummaries(sessionId, 3);
  }

  return context;
}

/**
 * Build context string for AI prompt
 */
export async function buildContextString(userId, sessionId, query) {
  const context = await getRelevantContext(userId, sessionId, query);
  const parts = [];

  // User preferences
  if (context.longTerm.length > 0) {
    parts.push('USER PREFERENCES:');
    context.longTerm.forEach(m => {
      parts.push(`- ${m.key}: ${m.value}`);
    });
  }

  // Recent context
  if (context.shortTerm.length > 0) {
    parts.push('\nRECENT CONTEXT:');
    context.shortTerm.forEach(m => {
      parts.push(`- [${m.memory_type}] ${m.content.substring(0, 200)}`);
    });
  }

  // Session summaries
  if (context.summaries.length > 0) {
    parts.push('\nSESSION HISTORY:');
    context.summaries.forEach(s => {
      parts.push(`- ${s.summary}`);
    });
  }

  return parts.join('\n');
}

// ============================================================================
// STATISTICS
// ============================================================================

export async function getMemoryStats(userId) {
  await ensureSchema();

  const stats = {};

  const working = await db.query(`SELECT COUNT(*) FROM working_memory WHERE expires_at > NOW()`);
  stats.workingMemory = parseInt(working.rows[0].count);

  const shortTerm = await db.query(`
    SELECT COUNT(*), AVG(importance) as avg_importance
    FROM short_term_memory
    WHERE user_id = $1 AND expires_at > NOW()
  `, [userId]);
  stats.shortTermMemory = {
    count: parseInt(shortTerm.rows[0].count),
    avgImportance: parseFloat(shortTerm.rows[0].avg_importance || 0).toFixed(2)
  };

  const longTerm = await db.query(`
    SELECT category, COUNT(*), AVG(confidence) as avg_confidence
    FROM long_term_memory
    WHERE user_id = $1
    GROUP BY category
  `, [userId]);
  stats.longTermMemory = longTerm.rows;

  const summaries = await db.query(`SELECT COUNT(*) FROM context_summaries`);
  stats.contextSummaries = parseInt(summaries.rows[0].count);

  return stats;
}

export default {
  // Working memory
  addToWorkingMemory,
  getWorkingMemory,
  boostRelevance,

  // Short-term memory
  storeShortTerm,
  getShortTermMemories,
  searchShortTerm,

  // Long-term memory
  storeLongTerm,
  getLongTermByCategory,
  getLongTerm,
  getUserPreferences,

  // Summaries
  createContextSummary,
  getContextSummaries,

  // Consolidation
  consolidateMemories,
  decayMemories,

  // Retrieval
  getRelevantContext,
  buildContextString,

  // Stats
  getMemoryStats
};
