import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Log connection events
pool.on('connect', () => {
  console.log('Database: New client connected');
});

pool.on('error', (err) => {
  console.error('Database: Unexpected error on idle client', err);
});

// Query helper
export async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;

  if (process.env.DEBUG_SQL) {
    console.log('Query:', { text: text.substring(0, 100), duration, rows: result.rowCount });
  }

  return result;
}

// Transaction helper
export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ============================================================================
// CONVERSATIONS
// ============================================================================

export async function saveMessage(sessionId, role, content, metadata = {}) {
  const result = await query(
    `INSERT INTO conversations (session_id, role, content, metadata)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [sessionId, role, content, JSON.stringify(metadata)]
  );
  return result.rows[0];
}

export async function getConversation(sessionId, limit = 50) {
  const result = await query(
    `SELECT * FROM conversations
     WHERE session_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [sessionId, limit]
  );
  return result.rows;
}

export async function getRecentContext(sessionId, limit = 10) {
  const result = await query(
    `SELECT role, content FROM conversations
     WHERE session_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [sessionId, limit]
  );
  return result.rows.reverse();
}

// ============================================================================
// TASKS
// ============================================================================

export async function createTask(type, input, priority = 0) {
  const result = await query(
    `INSERT INTO tasks (type, input, priority)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [type, JSON.stringify(input), priority]
  );
  return result.rows[0];
}

export async function getTask(taskId) {
  const result = await query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  return result.rows[0];
}

export async function updateTask(taskId, updates) {
  const { status, output, error } = updates;
  const result = await query(
    `UPDATE tasks SET
       status = COALESCE($2, status),
       output = COALESCE($3, output),
       error = COALESCE($4, error),
       started_at = CASE WHEN $2 = 'processing' THEN NOW() ELSE started_at END,
       completed_at = CASE WHEN $2 IN ('completed', 'failed') THEN NOW() ELSE completed_at END
     WHERE id = $1
     RETURNING *`,
    [taskId, status, output ? JSON.stringify(output) : null, error]
  );
  return result.rows[0];
}

export async function getPendingTasks(limit = 10) {
  const result = await query(
    `SELECT * FROM tasks
     WHERE status = 'pending'
     ORDER BY priority DESC, created_at ASC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

// ============================================================================
// AI RESPONSES
// ============================================================================

export async function saveAiResponse(taskId, provider, response, metrics) {
  const { tokensIn, tokensOut, costUsd, latencyMs, success, error } = metrics;
  const result = await query(
    `INSERT INTO ai_responses (task_id, provider, response, tokens_in, tokens_out, cost_usd, latency_ms, success, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [taskId, provider, response, tokensIn, tokensOut, costUsd, latencyMs, success, error]
  );
  return result.rows[0];
}

export async function getAiResponses(taskId) {
  const result = await query(
    'SELECT * FROM ai_responses WHERE task_id = $1 ORDER BY created_at',
    [taskId]
  );
  return result.rows;
}

// ============================================================================
// CONSENSUS
// ============================================================================

export async function saveConsensus(taskId, method, winner, finalResponse, scores, reasoning) {
  const result = await query(
    `INSERT INTO consensus_results (task_id, method, winner, final_response, scores, reasoning)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [taskId, method, winner, finalResponse, JSON.stringify(scores), reasoning]
  );
  return result.rows[0];
}

// ============================================================================
// MEMORY (Key-Value Store)
// ============================================================================

export async function setMemory(key, value, category = 'general', expiresAt = null) {
  const result = await query(
    `INSERT INTO memory (key, value, category, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (key) DO UPDATE SET
       value = $2,
       category = $3,
       expires_at = $4,
       updated_at = NOW()
     RETURNING *`,
    [key, JSON.stringify(value), category, expiresAt]
  );
  return result.rows[0];
}

export async function getMemory(key) {
  const result = await query(
    `SELECT * FROM memory
     WHERE key = $1
     AND (expires_at IS NULL OR expires_at > NOW())`,
    [key]
  );
  return result.rows[0]?.value;
}

export async function getMemoryByCategory(category) {
  const result = await query(
    `SELECT key, value FROM memory
     WHERE category = $1
     AND (expires_at IS NULL OR expires_at > NOW())`,
    [category]
  );
  return result.rows.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

export async function deleteMemory(key) {
  await query('DELETE FROM memory WHERE key = $1', [key]);
}

// ============================================================================
// USAGE TRACKING
// ============================================================================

export async function logUsage(provider, tokensIn, tokensOut, costUsd, endpoint = null) {
  const result = await query(
    `INSERT INTO usage_logs (provider, tokens_in, tokens_out, cost_usd, endpoint)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [provider, tokensIn, tokensOut, costUsd, endpoint]
  );
  return result.rows[0];
}

export async function getUsageSummary(days = 30) {
  // Validate days to prevent SQL injection (must be positive integer 1-365)
  const safeDays = Math.min(Math.max(1, parseInt(days) || 30), 365);

  const result = await query(
    `SELECT
       provider,
       COUNT(*) as calls,
       SUM(tokens_in) as total_tokens_in,
       SUM(tokens_out) as total_tokens_out,
       SUM(cost_usd) as total_cost,
       DATE(created_at) as date
     FROM usage_logs
     WHERE created_at > NOW() - INTERVAL '1 day' * $1
     GROUP BY provider, DATE(created_at)
     ORDER BY date DESC, provider`,
    [safeDays]
  );
  return result.rows;
}

export async function getTodayUsage() {
  const result = await query(
    `SELECT
       provider,
       COUNT(*) as calls,
       SUM(tokens_in) as tokens_in,
       SUM(tokens_out) as tokens_out,
       SUM(cost_usd) as cost
     FROM usage_logs
     WHERE DATE(created_at) = CURRENT_DATE
     GROUP BY provider`
  );
  return result.rows;
}

// ============================================================================
// CHANGE HISTORY - Tracks all bot code changes for rollback
// ============================================================================

export async function logChangeHistory(data) {
  const { repo, path, action, oldContent, newContent, message, userId, commitSha } = data;
  const result = await query(
    `INSERT INTO change_history (repo, path, action, old_content, new_content, message, user_id, commit_sha)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [repo, path, action, oldContent, newContent, message, userId, commitSha]
  );
  return result.rows[0];
}

export async function getChangeHistory(repo, limit = 20) {
  const result = await query(
    `SELECT * FROM change_history
     WHERE repo = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [repo, limit]
  );
  return result.rows;
}

export async function getChangeById(changeId) {
  const result = await query(
    'SELECT * FROM change_history WHERE id = $1',
    [changeId]
  );
  return result.rows[0];
}

export async function getFileChanges(repo, path, limit = 10) {
  const result = await query(
    `SELECT * FROM change_history
     WHERE repo = $1 AND path = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [repo, path, limit]
  );
  return result.rows;
}

// ============================================================================
// HEALTH
// ============================================================================

export async function logHealthCheck(checkType, status, message, data = {}) {
  const result = await query(
    `INSERT INTO health_checks (check_type, status, message, data)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [checkType, status, message, JSON.stringify(data)]
  );
  return result.rows[0];
}

export async function getRecentHealthChecks(limit = 20) {
  const result = await query(
    `SELECT * FROM health_checks ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

// ============================================================================
// AI RESPONSE CACHE - Speed up repeated queries
// ============================================================================

// Simple hash function for cache keys
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

export async function getCachedResponse(provider, content) {
  const cacheKey = `ai_cache:${provider}:${hashString(content)}`;
  try {
    const cached = await getMemory(cacheKey);
    if (cached) {
      console.log(`[Cache] HIT for ${provider} query`);
      return { ...cached, cached: true };
    }
  } catch (e) {
    // Cache miss or error, proceed without cache
  }
  return null;
}

export async function setCachedResponse(provider, content, response, ttlMinutes = 60) {
  const cacheKey = `ai_cache:${provider}:${hashString(content)}`;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  try {
    await setMemory(cacheKey, response, 'ai_cache', expiresAt);
    console.log(`[Cache] Stored ${provider} response (TTL: ${ttlMinutes}m)`);
  } catch (e) {
    console.error('[Cache] Failed to store:', e.message);
  }
}

export async function clearAICache() {
  try {
    await query(`DELETE FROM memory WHERE category = 'ai_cache'`);
    console.log('[Cache] AI cache cleared');
  } catch (e) {
    console.error('[Cache] Failed to clear:', e.message);
  }
}

export default pool;
