// ============================================================================
// VECTOR DATABASE SERVICE
// Semantic search with Pinecone, Redis, and in-memory fallback
// ============================================================================

import fetch from 'node-fetch';
import { createClient } from 'redis';
import { LRUCache } from '../utils/lru-cache.js';
import { cosineSimilarity } from '../utils/math.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX = process.env.PINECONE_INDEX || 'code-search';
const PINECONE_HOST = process.env.PINECONE_HOST; // e.g., 'code-search-xxxxx.svc.pinecone.io'

const REDIS_URL = process.env.REDIS_URL;

let redisClient = null;
let redisReconnectAttempts = 0;
const MAX_REDIS_RECONNECT_ATTEMPTS = 5;

// In-memory fallback for when no external DB is configured (LRU with limit)
const memoryVectorStore = new LRUCache(10000, 86400000); // 10k vectors, 24h TTL

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    pinecone: !!PINECONE_API_KEY && !!PINECONE_HOST,
    redis: !!REDIS_URL,
    memoryStore: true,
    vectorCount: memoryVectorStore.size
  };
}

// ============================================================================
// PINECONE OPERATIONS
// ============================================================================

/**
 * Upsert vectors to Pinecone
 * @param {string} namespace - Namespace for the vectors (e.g., repo name)
 * @param {Array<{id: string, values: number[], metadata: object}>} vectors
 */
export async function pineconeUpsert(namespace, vectors) {
  if (!PINECONE_API_KEY || !PINECONE_HOST) {
    // Fallback to memory
    for (const v of vectors) {
      memoryVectorStore.set(`${namespace}:${v.id}`, v);
    }
    return { upsertedCount: vectors.length, store: 'memory' };
  }

  const response = await fetch(`https://${PINECONE_HOST}/vectors/upsert`, {
    method: 'POST',
    headers: {
      'Api-Key': PINECONE_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      vectors,
      namespace
    })
  });

  const data = await response.json();
  return { upsertedCount: data.upsertedCount, store: 'pinecone' };
}

/**
 * Query Pinecone for similar vectors
 * @param {string} namespace - Namespace to search
 * @param {number[]} vector - Query vector
 * @param {number} topK - Number of results
 * @param {object} filter - Metadata filter
 */
export async function pineconeQuery(namespace, vector, topK = 10, filter = null) {
  if (!PINECONE_API_KEY || !PINECONE_HOST) {
    // Fallback to memory search
    return memoryQuery(namespace, vector, topK);
  }

  const body = {
    vector,
    topK,
    namespace,
    includeMetadata: true
  };

  if (filter) {
    body.filter = filter;
  }

  const response = await fetch(`https://${PINECONE_HOST}/query`, {
    method: 'POST',
    headers: {
      'Api-Key': PINECONE_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  return data.matches || [];
}

/**
 * Delete vectors from Pinecone
 * @param {string} namespace - Namespace
 * @param {string[]} ids - Vector IDs to delete
 */
export async function pineconeDelete(namespace, ids) {
  if (!PINECONE_API_KEY || !PINECONE_HOST) {
    for (const id of ids) {
      memoryVectorStore.delete(`${namespace}:${id}`);
    }
    return { deletedCount: ids.length, store: 'memory' };
  }

  const response = await fetch(`https://${PINECONE_HOST}/vectors/delete`, {
    method: 'POST',
    headers: {
      'Api-Key': PINECONE_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ids,
      namespace
    })
  });

  return { deletedCount: ids.length, store: 'pinecone' };
}

/**
 * Get Pinecone index stats
 */
export async function pineconeStats() {
  if (!PINECONE_API_KEY || !PINECONE_HOST) {
    return {
      store: 'memory',
      totalVectors: memoryVectorStore.size,
      namespaces: getMemoryNamespaces()
    };
  }

  const response = await fetch(`https://${PINECONE_HOST}/describe_index_stats`, {
    method: 'POST',
    headers: {
      'Api-Key': PINECONE_API_KEY,
      'Content-Type': 'application/json'
    },
    body: '{}'
  });

  const data = await response.json();
  return { store: 'pinecone', ...data };
}

// ============================================================================
// MEMORY VECTOR STORE (Fallback)
// ============================================================================

function memoryQuery(namespace, queryVector, topK) {
  const results = [];

  for (const [key, value] of memoryVectorStore.entries()) {
    if (key.startsWith(`${namespace}:`)) {
      const score = cosineSimilarity(queryVector, value.values);
      results.push({
        id: value.id,
        score,
        metadata: value.metadata
      });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function getMemoryNamespaces() {
  const namespaces = new Set();
  for (const key of memoryVectorStore.keys()) {
    const ns = key.split(':')[0];
    namespaces.add(ns);
  }
  return Array.from(namespaces);
}

// ============================================================================
// REDIS OPERATIONS
// ============================================================================

async function getRedisClient() {
  if (!REDIS_URL) return null;

  // Check if existing client is connected
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  // Check reconnect attempts
  if (redisReconnectAttempts >= MAX_REDIS_RECONNECT_ATTEMPTS) {
    console.log('[Redis] Max reconnection attempts reached, using memory fallback');
    return null;
  }

  try {
    // Close existing broken connection if any
    if (redisClient) {
      try {
        await redisClient.quit();
      } catch (e) {
        // Ignore quit errors
      }
      redisClient = null;
    }

    redisClient = createClient({
      url: REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            console.log('[Redis] Connection failed after 3 retries');
            return false; // Stop trying
          }
          return Math.min(retries * 100, 3000); // Exponential backoff, max 3s
        },
        connectTimeout: 10000 // 10 second timeout
      }
    });

    redisClient.on('error', (err) => {
      console.error('[Redis] Error:', err.message);
    });

    redisClient.on('reconnecting', () => {
      console.log('[Redis] Reconnecting...');
    });

    redisClient.on('ready', () => {
      console.log('[Redis] Connected and ready');
      redisReconnectAttempts = 0; // Reset on successful connection
    });

    await redisClient.connect();
    console.log('[Redis] Connected');
    redisReconnectAttempts = 0;
    return redisClient;
  } catch (err) {
    redisReconnectAttempts++;
    console.error(`[Redis] Connection failed (attempt ${redisReconnectAttempts}/${MAX_REDIS_RECONNECT_ATTEMPTS}):`, err.message);
    redisClient = null;
    return null;
  }
}

/**
 * Cache a value in Redis
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {number} ttlSeconds - Time to live in seconds
 */
export async function cacheSet(key, value, ttlSeconds = 3600) {
  const client = await getRedisClient();
  if (!client) {
    // Memory fallback
    memoryVectorStore.set(`cache:${key}`, {
      value,
      expiresAt: Date.now() + (ttlSeconds * 1000)
    });
    return true;
  }

  await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
  return true;
}

/**
 * Get a cached value from Redis
 * @param {string} key - Cache key
 */
export async function cacheGet(key) {
  const client = await getRedisClient();
  if (!client) {
    // Memory fallback
    const cached = memoryVectorStore.get(`cache:${key}`);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    return null;
  }

  const value = await client.get(key);
  return value ? JSON.parse(value) : null;
}

/**
 * Delete a cached value
 * @param {string} key - Cache key
 */
export async function cacheDel(key) {
  const client = await getRedisClient();
  if (!client) {
    memoryVectorStore.delete(`cache:${key}`);
    return true;
  }

  await client.del(key);
  return true;
}

/**
 * Cache with automatic refresh
 * @param {string} key - Cache key
 * @param {Function} fetchFn - Function to call if cache miss
 * @param {number} ttlSeconds - Cache TTL
 */
export async function cacheThrough(key, fetchFn, ttlSeconds = 3600) {
  const cached = await cacheGet(key);
  if (cached !== null) {
    return { value: cached, fromCache: true };
  }

  const value = await fetchFn();
  await cacheSet(key, value, ttlSeconds);
  return { value, fromCache: false };
}

// ============================================================================
// REDIS RATE LIMITING
// ============================================================================

/**
 * Check rate limit using Redis
 * @param {string} key - Rate limit key (e.g., user:123)
 * @param {number} maxRequests - Max requests allowed
 * @param {number} windowSeconds - Time window in seconds
 */
export async function checkRateLimit(key, maxRequests = 10, windowSeconds = 60) {
  const client = await getRedisClient();
  if (!client) {
    // No Redis = no distributed rate limiting, use in-memory
    return { allowed: true, remaining: maxRequests };
  }

  const now = Date.now();
  const windowStart = now - (windowSeconds * 1000);

  // Use sorted set for sliding window
  const redisKey = `ratelimit:${key}`;

  // Remove old entries
  await client.zRemRangeByScore(redisKey, 0, windowStart);

  // Count current entries
  const count = await client.zCard(redisKey);

  if (count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: windowStart + (windowSeconds * 1000)
    };
  }

  // Add new entry
  await client.zAdd(redisKey, { score: now, value: `${now}` });
  await client.expire(redisKey, windowSeconds);

  return {
    allowed: true,
    remaining: maxRequests - count - 1
  };
}

// ============================================================================
// REDIS PUB/SUB (Real-time messaging)
// ============================================================================

const subscribers = new Map();

/**
 * Subscribe to a channel
 * @param {string} channel - Channel name
 * @param {Function} callback - Message handler
 */
export async function subscribe(channel, callback) {
  const client = await getRedisClient();
  if (!client) {
    // Memory fallback - store callback
    if (!subscribers.has(channel)) {
      subscribers.set(channel, []);
    }
    subscribers.get(channel).push(callback);
    return true;
  }

  const subscriber = client.duplicate();
  await subscriber.connect();
  await subscriber.subscribe(channel, callback);

  return subscriber;
}

/**
 * Publish to a channel
 * @param {string} channel - Channel name
 * @param {any} message - Message to publish
 */
export async function publish(channel, message) {
  const client = await getRedisClient();
  if (!client) {
    // Memory fallback - call local subscribers
    const callbacks = subscribers.get(channel) || [];
    for (const cb of callbacks) {
      cb(JSON.stringify(message));
    }
    return callbacks.length;
  }

  await client.publish(channel, JSON.stringify(message));
  return true;
}

// ============================================================================
// HIGH-LEVEL SEARCH FUNCTIONS
// ============================================================================

/**
 * Index a code file for semantic search
 * @param {string} repo - Repository name
 * @param {string} path - File path
 * @param {string} content - File content
 * @param {number[]} embedding - Pre-computed embedding
 */
export async function indexFile(repo, path, content, embedding) {
  const id = `${repo}:${path}`.replace(/[^a-zA-Z0-9_-]/g, '_');

  return await pineconeUpsert(repo, [{
    id,
    values: embedding,
    metadata: {
      repo,
      path,
      content: content.substring(0, 1000), // Store preview
      language: getLanguageFromPath(path),
      indexedAt: new Date().toISOString()
    }
  }]);
}

/**
 * Search indexed code files
 * @param {string} repo - Repository to search (or 'all')
 * @param {number[]} queryEmbedding - Query embedding
 * @param {number} topK - Number of results
 */
export async function searchCode(repo, queryEmbedding, topK = 10) {
  const namespace = repo === 'all' ? '' : repo;
  return await pineconeQuery(namespace, queryEmbedding, topK);
}

/**
 * Delete all indexed files for a repo
 * @param {string} repo - Repository name
 */
export async function clearRepoIndex(repo) {
  if (!PINECONE_API_KEY || !PINECONE_HOST) {
    // Memory fallback
    for (const key of memoryVectorStore.keys()) {
      if (key.startsWith(`${repo}:`)) {
        memoryVectorStore.delete(key);
      }
    }
    return { cleared: true, store: 'memory' };
  }

  const response = await fetch(`https://${PINECONE_HOST}/vectors/delete`, {
    method: 'POST',
    headers: {
      'Api-Key': PINECONE_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      deleteAll: true,
      namespace: repo
    })
  });

  return { cleared: true, store: 'pinecone' };
}

function getLanguageFromPath(path) {
  const ext = path.split('.').pop().toLowerCase();
  const languages = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    rb: 'ruby',
    php: 'php',
    cs: 'csharp',
    cpp: 'cpp',
    c: 'c',
    swift: 'swift',
    kt: 'kotlin',
    md: 'markdown',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml'
  };
  return languages[ext] || 'unknown';
}

// ============================================================================
// CLEANUP
// ============================================================================

export async function disconnect() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

export default {
  getStatus,
  // Pinecone
  pineconeUpsert,
  pineconeQuery,
  pineconeDelete,
  pineconeStats,
  // Redis cache
  cacheSet,
  cacheGet,
  cacheDel,
  cacheThrough,
  // Redis rate limiting
  checkRateLimit,
  // Redis pub/sub
  subscribe,
  publish,
  // High-level
  indexFile,
  searchCode,
  clearRepoIndex,
  disconnect
};
