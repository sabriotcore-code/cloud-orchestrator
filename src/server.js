import dotenv from 'dotenv';
dotenv.config(); // Load env first

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { v4 as uuidv4 } from 'uuid';

import * as db from './db/index.js';
import * as ai from './services/ai.js';
import * as github from './services/github.js';
import * as web from './services/web.js';
import * as google from './services/google.js';
import * as googleAI from './services/google-ai.js';
import * as aiProviders from './services/ai-providers.js';
import * as vectorDb from './services/vector-db.js';
import * as devops from './services/devops.js';
import * as business from './services/business.js';
import * as security from './services/security.js';
import * as smart from './services/smart.js';
import * as memory from './services/memory.js';
import * as context from './services/context.js';
import * as changelog from './services/changelog.js';
import * as neo4j from './services/neo4j.js';
import * as e2b from './services/e2b.js';
import * as firecrawl from './services/firecrawl.js';
import * as mem0 from './services/mem0.js';
import { registerNewServiceEndpoints } from './services/endpoints.js';
import { initSlack, slackApp } from './services/slack.js';

// Intelligence Systems
import * as reflection from './services/reflection.js';
import * as contextMemory from './services/context-memory.js';
import * as reasoning from './services/reasoning.js';
import * as anticipation from './services/anticipation.js';
import * as reinforcement from './services/reinforcement.js';

// Advanced Intelligence Systems (Phase 2)
import * as enhancedRag from './services/enhanced-rag.js';
import * as multimodal from './services/multimodal.js';
import * as codegen from './services/codegen.js';
import * as sentimentAnalysis from './services/sentiment.js';
import * as anomaly from './services/anomaly.js';
import * as causal from './services/causal.js';
import * as planner from './services/planner.js';
import * as automl from './services/automl.js';
import * as monitoring from './services/monitoring.js';
import * as nlpInterface from './services/nlp-interface.js';

// General Intelligence Systems (Phase 3 - 20 capabilities)
import * as vision from './services/vision.js';
import * as audio from './services/audio.js';
import * as video from './services/video.js';
import * as documents from './services/documents.js';
import * as symbolic from './services/symbolic.js';
import * as probabilistic from './services/probabilistic.js';
import * as metacognition from './services/metacognition.js';
import * as learning from './services/learning.js';
import * as scientific from './services/scientific.js';
import * as explainability from './services/explainability.js';
import {
  usernameToId,
  extractJson,
  splitForSlack,
  isRiskyFile,
  truncate,
  withRetry,
  checkRateLimit
} from './utils/helpers.js';

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// MIDDLEWARE
// ============================================================================

app.use(helmet());
app.use(cors());

// Slack needs raw body for signature verification - must come before express.json
app.use('/slack/events', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));

// Request logging with correlation ID
app.use((req, res, next) => {
  req.id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] [${req.id}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// ============================================================================
// RATE LIMITING - Prevent abuse and DDoS (Redis-backed for distributed)
// ============================================================================

// Database-backed rate limiting (shared across all instances via PostgreSQL)
let rateLimitTableReady = false;

async function ensureRateLimitTable() {
  if (rateLimitTableReady) return true;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        key VARCHAR(255) PRIMARY KEY,
        count INTEGER DEFAULT 1,
        window_start TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Clean old entries on startup
    await db.query(`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '2 minutes'`);
    rateLimitTableReady = true;
    console.log('[RateLimit] Using PostgreSQL for distributed rate limiting');
    return true;
  } catch (err) {
    console.error('[RateLimit] Failed to create table:', err.message);
    return false;
  }
}

async function checkRateLimitDB(key, maxRequests, windowMs) {
  const windowSec = Math.ceil(windowMs / 1000);
  try {
    // Atomic upsert with increment
    const result = await db.query(`
      INSERT INTO rate_limits (key, count, window_start)
      VALUES ($1, 1, NOW())
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN rate_limits.window_start < NOW() - INTERVAL '1 second' * $2
          THEN 1
          ELSE rate_limits.count + 1
        END,
        window_start = CASE
          WHEN rate_limits.window_start < NOW() - INTERVAL '1 second' * $2
          THEN NOW()
          ELSE rate_limits.window_start
        END
      RETURNING count, window_start
    `, [key, windowSec]);

    return {
      count: result.rows[0].count,
      windowStart: result.rows[0].window_start
    };
  } catch (err) {
    console.error('[RateLimit DB] Error:', err.message);
    return null; // Fail open
  }
}

// Clean up old rate limit entries every 2 minutes
setInterval(async () => {
  if (rateLimitTableReady) {
    try {
      await db.query(`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '2 minutes'`);
    } catch (e) { /* ignore cleanup errors */ }
  }
}, 120000);

const RATE_LIMITS = {
  '/e2b/': { max: 10, windowMs: 60000 },      // Code execution: 10/min
  '/ai/': { max: 30, windowMs: 60000 },        // AI queries: 30/min
  '/firecrawl/': { max: 20, windowMs: 60000 }, // Web scraping: 20/min
  'default': { max: 100, windowMs: 60000 }     // Default: 100/min
};

function getRateLimitConfig(path) {
  for (const [prefix, config] of Object.entries(RATE_LIMITS)) {
    if (prefix !== 'default' && path.startsWith(prefix)) {
      return config;
    }
  }
  return RATE_LIMITS.default;
}

// Rate limit middleware - PostgreSQL-backed for distributed rate limiting
app.use(async (req, res, next) => {
  // Skip rate limiting for health checks
  if (req.path === '/' || req.path === '/health') {
    return next();
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || req.connection.remoteAddress || 'unknown';
  const config = getRateLimitConfig(req.path);
  const endpoint = req.path.split('/')[1] || 'root';
  const key = `${ip}:${endpoint}`;

  try {
    // Ensure rate limit table exists
    await ensureRateLimitTable();

    // Use PostgreSQL for distributed rate limiting
    const result = await checkRateLimitDB(key, config.max, config.windowMs);

    if (result) {
      const resetTime = new Date(result.windowStart).getTime() + config.windowMs;
      const ttl = Math.ceil((resetTime - Date.now()) / 1000);

      res.set('X-RateLimit-Limit', config.max);
      res.set('X-RateLimit-Remaining', Math.max(0, config.max - result.count));
      res.set('X-RateLimit-Reset', new Date(resetTime).toISOString());

      if (result.count > config.max) {
        console.log(`[RateLimit] Blocked ${ip} on ${req.path} (${result.count}/${config.max})`);
        return res.status(429).json({
          error: 'Too many requests',
          retryAfter: Math.max(1, ttl)
        });
      }
    }
    // If result is null (DB error), fail open and allow request
  } catch (err) {
    console.error('[RateLimit] Error:', err.message);
    // On error, allow request through (fail-open)
  }

  next();
});

// ============================================================================
// REQUEST TIMEOUT - Prevent hanging requests
// ============================================================================

const REQUEST_TIMEOUTS = {
  '/e2b/': 120000,      // Code execution: 2 minutes
  '/firecrawl/': 60000, // Web scraping: 1 minute
  '/ai/': 45000,        // AI queries: 45 seconds
  'default': 30000      // Default: 30 seconds
};

function getTimeoutConfig(path) {
  for (const [prefix, timeout] of Object.entries(REQUEST_TIMEOUTS)) {
    if (prefix !== 'default' && path.startsWith(prefix)) {
      return timeout;
    }
  }
  return REQUEST_TIMEOUTS.default;
}

app.use((req, res, next) => {
  const timeout = getTimeoutConfig(req.path);
  res.setTimeout(timeout, () => {
    console.log(`[Timeout] Request ${req.id} timed out after ${timeout}ms: ${req.method} ${req.path}`);
    if (!res.headersSent) {
      res.status(504).json({ error: 'Request timeout', timeoutMs: timeout });
    }
  });
  next();
});

// ============================================================================
// HEALTH & STATUS
// ============================================================================

app.get('/', (req, res) => {
  res.json({
    name: 'Cloud Orchestrator',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await db.query('SELECT 1');

    // Check AI providers
    const providers = ai.getProviderStatus();

    // Check GitHub
    const githubUser = await github.getAuthenticatedUser();

    res.json({
      status: 'healthy',
      database: 'connected',
      providers,
      cache: db.getCacheStats(),
      github: githubUser ? { connected: true, user: githubUser.login } : { connected: false },
      google: google.isConfigured(),
      webSearch: web.isConfigured(),
      neo4j: neo4j.getNeo4jStatus(),
      e2b: e2b.getE2BStatus(),
      firecrawl: firecrawl.getFirecrawlStatus(),
      mem0: mem0.getMem0Status(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
    });
  }
});

// ============================================================================
// AI ENDPOINTS
// ============================================================================

// Multi-AI query (parallel) - MUST come before :provider route
app.post('/ai/all', async (req, res) => {
  const { content, promptType = 'general' } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  const results = await ai.askAll(content, promptType);
  res.json(results);
});

// Multi-AI with consensus - MUST come before :provider route
app.post('/ai/consensus', async (req, res) => {
  const { content, promptType = 'general', consensusMethod = 'weighted' } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  // Query all AIs
  const results = await ai.askAll(content, promptType);

  // Build consensus
  const consensus = await ai.buildConsensus(results, consensusMethod);

  res.json({
    individual: results,
    consensus,
  });
});

// Fast AI query - auto-routes to fastest available provider with caching
app.post('/ai/fast', async (req, res) => {
  const { content, prompt, skipCache } = req.body;
  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  const start = Date.now();
  const cacheKey = `fast:${prompt || ''}:${content}`;

  // Check in-memory LRU cache first (0ms)
  if (!skipCache) {
    const memCached = db.aiCache.get(cacheKey);
    if (memCached) {
      return res.json({
        ...memCached,
        cached: true,
        cacheType: 'memory',
        latencyMs: Date.now() - start
      });
    }
    // Fallback to DB cache
    const dbCached = await db.getCachedResponse('fast', content);
    if (dbCached) {
      // Promote to memory cache
      db.aiCache.set(cacheKey, dbCached);
      dbCached.latencyMs = Date.now() - start;
      dbCached.cacheType = 'database';
      return res.json(dbCached);
    }
  }

  let result;
  let provider;

  // Try providers in order of speed: Groq > Gemini > GPT-3.5
  const providerStatus = aiProviders.getProviderStatus();

  try {
    if (providerStatus.groq) {
      provider = 'groq';
      result = await aiProviders.fastChat(content, { system: prompt });
    } else if (providerStatus.gemini) {
      provider = 'gemini';
      result = await ai.askGemini(content, prompt);
    } else {
      provider = 'gpt';
      result = await ai.askGPT(content, prompt);
    }

    result.provider = provider;
    result.latencyMs = Date.now() - start;

    // Cache successful responses in both memory (instant) and DB (persistent)
    // Check for response (Groq/Gemini) or success flag
    if (result.response || result.success) {
      db.aiCache.set(cacheKey, result, 3600000); // 1hr memory cache
      db.setCachedResponse('fast', content, result, 60); // 60min DB cache
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message, provider });
  }
});

// Single AI query (parameterized - must come AFTER specific routes)
app.post('/ai/:provider', async (req, res) => {
  const { provider } = req.params;
  const { content, prompt } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  let result;
  switch (provider) {
    case 'claude':
      result = await ai.askClaude(content, prompt);
      break;
    case 'gpt':
      result = await ai.askGPT(content, prompt);
      break;
    case 'gemini':
      result = await ai.askGemini(content, prompt);
      break;
    // Fast inference providers (use chat() with provider name)
    case 'groq':
      result = await aiProviders.chat('groq', content, { system: prompt });
      break;
    case 'together':
      result = await aiProviders.chat('together', content, { system: prompt });
      break;
    case 'mistral':
      result = await aiProviders.chat('mistral', content, { system: prompt });
      break;
    default:
      return res.status(400).json({ error: 'Invalid provider. Use: claude, gpt, gemini, groq, together, mistral' });
  }

  res.json(result);
});

// Review endpoint (like the original orchestrator)
app.post('/review', async (req, res) => {
  const { content, mode = 'review' } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  const promptType = mode === 'challenge' ? 'challenge' : 'review';
  const results = await ai.askAll(content, promptType);

  // Format response like the original orchestrator
  const formatted = {
    timestamp: new Date().toISOString(),
    mode,
    responses: {
      claude: results.claude.success ? results.claude.response : `ERROR: ${results.claude.error}`,
      gpt: results.gpt.success ? results.gpt.response : `ERROR: ${results.gpt.error}`,
      gemini: results.gemini.success ? results.gemini.response : `ERROR: ${results.gemini.error}`,
    },
    metrics: {
      claude: { latency: results.claude.latencyMs, cost: results.claude.costUsd },
      gpt: { latency: results.gpt.latencyMs, cost: results.gpt.costUsd },
      gemini: { latency: results.gemini.latencyMs, cost: results.gemini.costUsd },
    },
    totalCost: (results.claude.costUsd || 0) + (results.gpt.costUsd || 0) + (results.gemini.costUsd || 0),
  };

  res.json(formatted);
});

// ============================================================================
// CONVERSATION / MEMORY
// ============================================================================

// Chat endpoint with memory
app.post('/chat', async (req, res) => {
  const { sessionId = uuidv4(), message, provider = 'claude' } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // Save user message
  await db.saveMessage(sessionId, 'user', message);

  // Get conversation context
  const context = await db.getRecentContext(sessionId, 10);
  const contextString = context.map(m => `${m.role}: ${m.content}`).join('\n');

  // Build prompt with context
  const fullPrompt = context.length > 0
    ? `Previous conversation:\n${contextString}\n\nCurrent message: ${message}`
    : message;

  // Get AI response
  let result;
  switch (provider) {
    case 'gpt':
      result = await ai.askGPT(fullPrompt);
      break;
    case 'gemini':
      result = await ai.askGemini(fullPrompt);
      break;
    default:
      result = await ai.askClaude(fullPrompt);
  }

  if (result.success) {
    // Save assistant response
    await db.saveMessage(sessionId, 'assistant', result.response);
  }

  res.json({
    sessionId,
    response: result.response,
    success: result.success,
    error: result.error,
  });
});

// Get conversation history
app.get('/chat/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const conversation = await db.getConversation(sessionId);
  res.json({ sessionId, messages: conversation });
});

// ============================================================================
// MEMORY (Key-Value Store)
// ============================================================================

app.post('/memory', async (req, res) => {
  const { key, value, category = 'general', expiresIn } = req.body;

  if (!key || value === undefined) {
    return res.status(400).json({ error: 'Key and value are required' });
  }

  const expiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  const result = await db.setMemory(key, value, category, expiresAt);
  res.json({ success: true, key, stored: result });
});

app.get('/memory/:key', async (req, res) => {
  const value = await db.getMemory(req.params.key);
  if (value === undefined) {
    return res.status(404).json({ error: 'Key not found' });
  }
  res.json({ key: req.params.key, value });
});

app.get('/memory/category/:category', async (req, res) => {
  const values = await db.getMemoryByCategory(req.params.category);
  res.json({ category: req.params.category, values });
});

app.delete('/memory/:key', async (req, res) => {
  await db.deleteMemory(req.params.key);
  res.json({ success: true });
});

// ============================================================================
// TASKS (Async Queue)
// ============================================================================

app.post('/tasks', async (req, res) => {
  const { type, input, priority = 0 } = req.body;

  if (!type || !input) {
    return res.status(400).json({ error: 'Type and input are required' });
  }

  const task = await db.createTask(type, input, priority);
  res.json({ success: true, task });
});

app.get('/tasks/:taskId', async (req, res) => {
  const task = await db.getTask(req.params.taskId);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  res.json(task);
});

app.get('/tasks', async (req, res) => {
  const tasks = await db.getPendingTasks(20);
  res.json({ pending: tasks.length, tasks });
});

// ============================================================================
// USAGE & STATS
// ============================================================================

app.get('/usage', async (req, res) => {
  const [today, summary] = await Promise.all([
    db.getTodayUsage(),
    db.getUsageSummary(30),
  ]);

  res.json({ today, last30Days: summary });
});

// ============================================================================
// GITHUB ENDPOINTS
// ============================================================================

// List all repos
app.get('/github/repos', async (req, res) => {
  try {
    const repos = await github.listRepos(50);
    res.json({ count: repos.length, repos });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get repo details
app.get('/github/repos/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const data = await github.getRepo(owner, repo);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List files in repo
app.get('/github/repos/:owner/:repo/files', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { path = '' } = req.query;
    const files = await github.listFiles(owner, repo, path);
    res.json({ path, files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Read a file
app.get('/github/repos/:owner/:repo/file/*', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const path = req.params[0];
    const file = await github.readFile(owner, repo, path);
    res.json(file);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get commits
app.get('/github/repos/:owner/:repo/commits', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const commits = await github.getCommits(owner, repo, 20);
    res.json({ commits });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List issues
app.get('/github/repos/:owner/:repo/issues', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { state = 'open' } = req.query;
    const issues = await github.listIssues(owner, repo, state);
    res.json({ issues });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create issue
app.post('/github/repos/:owner/:repo/issues', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { title, body, labels } = req.body;
    const issue = await github.createIssue(owner, repo, title, body, labels);
    res.json(issue);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List PRs
app.get('/github/repos/:owner/:repo/pulls', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { state = 'open' } = req.query;
    const prs = await github.listPullRequests(owner, repo, state);
    res.json({ pullRequests: prs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search code
app.get('/github/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter q is required' });
    }
    const results = await github.searchCode(q);
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create/update file (commit)
app.put('/github/repos/:owner/:repo/file/*', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const path = req.params[0];
    const { content, message, sha } = req.body;

    if (!content || !message) {
      return res.status(400).json({ error: 'content and message are required' });
    }

    const result = await github.createOrUpdateFile(owner, repo, path, content, message, sha);
    res.json({ success: true, commit: result.commit.sha });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ============================================================================
// HELPER FUNCTIONS FOR SMART BOT
// ============================================================================

// Get help response
function getHelpResponse() {
  return { master: {
    response: `🤖 *AI Orchestrator - What I Can Do:*\n\n` +
      `*💬 Ask Questions:*\n• "what does rei-dashboard do"\n• "explain the cloud-orchestrator"\n\n` +
      `*📂 GitHub:*\n• "show my repos"\n• "read package.json from cloud-orchestrator"\n• "create file X in repo Y"\n• "deploy cloud-orchestrator"\n\n` +
      `*🔧 Execute Tasks:*\n• "fix the API error in rei-dashboard"\n• "migrate rei-dashboard to Railway"\n• When I show a plan, say "yes" to execute\n\n` +
      `*🧠 Memory:*\n• "remember that API key is XYZ"\n• "what do you remember"\n\n` +
      `*🌐 Web:*\n• "search the web for nodejs best practices"\n\n` +
      `_Just describe what you want in plain English!_`
  }};
}

// Execute a pending plan
async function executePendingPlan(userId) {
  try {
    const normalizedUserId = usernameToId(userId);
    const storedPlan = await memory.retrieve(`plan_${normalizedUserId}`);

    if (!storedPlan.value) {
      return { master: { response: `❌ No pending plan found. Describe what you want to do and I'll create a plan.` }};
    }

    let plan;
    try {
      plan = JSON.parse(storedPlan.value);
    } catch (e) {
      return { master: { response: `❌ Could not parse stored plan. Please create a new one.` }};
    }

    let executionLog = `🚀 *Executing Plan...*\n\n`;
    let stepsExecuted = 0;
    let stepsFailed = 0;

    // Handle EXECUTE_PLAN format (fixes array from investigation)
    if (plan.fixes && plan.fixes.length > 0) {
      executionLog += `📋 *Applying ${plan.fixes.length} fix(es)...*\n\n`;

      for (const fix of plan.fixes) {
        executionLog += `🔄 *${fix.file}:* ${fix.description}\n`;

        try {
          // Determine target repo from the stored context or default
          const targetOwner = plan.owner || 'sabriotcore-code';
          const targetRepo = plan.repo || 'rei-dashboard';

          // Read current file
          const currentFile = await github.readFile(targetOwner, targetRepo, fix.file);
          let newContent = currentFile.content;

          // Apply the fix
          if (fix.oldCode && fix.newCode) {
            if (newContent.includes(fix.oldCode)) {
              newContent = newContent.replace(fix.oldCode, fix.newCode);
            } else {
              // Try partial match for truncated oldCode
              const oldCodeStart = fix.oldCode.substring(0, 50);
              if (newContent.includes(oldCodeStart)) {
                const startIdx = newContent.indexOf(oldCodeStart);
                // Replace from that point with the new code
                newContent = newContent.substring(0, startIdx) + fix.newCode;
              } else {
                executionLog += `  ⚠️ Could not find exact match for replacement\n`;
                stepsFailed++;
                continue;
              }
            }
          } else if (fix.newCode) {
            newContent = fix.newCode;
          }

          // Commit the fix
          await github.createOrUpdateFile(
            targetOwner,
            targetRepo,
            fix.file,
            newContent,
            `Fix: ${fix.description}`,
            currentFile.sha,
            userId
          );

          executionLog += `  ✅ Committed!\n`;
          stepsExecuted++;
        } catch (stepError) {
          executionLog += `  ❌ Failed: ${stepError.message}\n`;
          stepsFailed++;
        }
      }

      executionLog += `\n*Summary:* ${stepsExecuted} files fixed, ${stepsFailed} failed\n`;

      if (plan.manualSteps && plan.manualSteps.length > 0) {
        executionLog += `\n*Manual Steps Still Needed:*\n`;
        for (const ms of plan.manualSteps) {
          executionLog += `👤 ${ms}\n`;
        }
      }

      executionLog += `\n_Use "/do history" to see changes. Use "/do rollback" to undo._`;

      // Clear the stored plan
      await memory.store(`plan_${normalizedUserId}`, '', 'plans');
    }
    // Handle old plan format (step-based)
    else if (plan.plan) {
      for (const step of plan.plan) {
        if (!step.automated) {
          executionLog += `⏭️ *Step ${step.step}:* ${step.action} _(manual)_\n`;
          continue;
        }

        executionLog += `🔄 *Step ${step.step}:* ${step.action}...\n`;

        try {
          if (step.api === 'github.getContent' || step.action.toLowerCase().includes('read')) {
            const path = step.parameters?.path || '';
            const repo = step.parameters?.repo || 'rei-dashboard';
            const owner = step.parameters?.owner || 'sabriotcore-code';

            if (path) {
              const content = await github.readFile(owner, repo, path);
              executionLog += `  ✅ Read ${path} (${content.size || 0} bytes)\n`;
            } else {
              const files = await github.listFiles(owner, repo, '');
              executionLog += `  ✅ Listed ${files.length} files\n`;
            }
            stepsExecuted++;
          } else {
            executionLog += `  ℹ️ Noted\n`;
            stepsExecuted++;
          }
        } catch (stepError) {
          executionLog += `  ❌ Failed: ${stepError.message}\n`;
          stepsFailed++;
        }
      }

      executionLog += `\n*Summary:* ${stepsExecuted} steps, ${stepsFailed} failed\n`;

      // Clear the stored plan
      await memory.store(`plan_${normalizedUserId}`, '', 'plans');
    } else {
      executionLog += `⚠️ Plan format not recognized. Please try again.`;
    }

    await context.updateContext('CURRENT WORK', `Executed plan with ${stepsExecuted} fixes`);

    return { master: { response: executionLog }};
  } catch (e) {
    return { master: { response: `❌ Failed to execute plan: ${e.message}` }};
  }
}

// ============================================================================
// #15: CODE EXPLANATION HELPER
// ============================================================================

async function explainCode(target, userId) {
  try {
    let response = `📚 *Explaining: ${target}*\n\n`;

    // Determine if target is a file, repo, or concept
    const isFile = target.match(/\.(js|html|css|json|md|ts|py)$/);
    const isRepo = ['rei-dashboard', 'cloud-orchestrator', 'ai-orchestrator', 'rei-automation'].includes(target.toLowerCase());

    let codeToExplain = '';

    if (isFile) {
      // Try to find the file
      for (const repo of ['cloud-orchestrator', 'rei-dashboard', 'rei-automation']) {
        try {
          const file = await github.readFile('sabriotcore-code', repo, target);
          codeToExplain = file.content;
          response += `📁 *Found in:* ${repo}\n\n`;
          break;
        } catch (e) { /* try next */ }
      }
    } else if (isRepo) {
      // Get repo overview
      const files = await github.listFiles('sabriotcore-code', target, '');
      const mainFiles = [];

      for (const f of files.slice(0, 5)) {
        if (f.name.endsWith('.js') || f.name.endsWith('.html') || f.name === 'package.json') {
          try {
            const content = await github.readFile('sabriotcore-code', target, f.name);
            mainFiles.push({ name: f.name, content: content.content.substring(0, 1500) });
          } catch (e) { /* ignore */ }
        }
      }

      codeToExplain = mainFiles.map(f => `=== ${f.name} ===\n${f.content}`).join('\n\n');
      response += `📂 *Repository:* ${target}\n📁 *Files:* ${files.map(f => f.name).join(', ')}\n\n`;
    }

    if (!codeToExplain) {
      // Just explain the concept
      const conceptResult = await ai.askClaude(`Explain this concept in the context of web development and Node.js: ${target}`, '');
      return { master: { response: response + conceptResult.response }};
    }

    // Ask Claude to explain the code
    const explainPrompt = `You are a senior developer explaining code to a colleague.

CODE TO EXPLAIN:
${codeToExplain.substring(0, 8000)}

Provide a clear explanation covering:
1. **Purpose**: What does this code do?
2. **Key Components**: Main functions, classes, or modules
3. **Data Flow**: How does data move through the code?
4. **Dependencies**: What does it rely on?
5. **Potential Issues**: Any concerns or areas for improvement?

Keep the explanation practical and actionable.`;

    const explanation = await ai.askClaude(explainPrompt, '');

    if (explanation.success) {
      response += explanation.response;
    } else {
      response += `❌ Could not generate explanation: ${explanation.error}`;
    }

    // Store for context
    await memory.store(`last_response_${userId}`, `Explained ${target}`, 'context');

    return { master: { response }};
  } catch (e) {
    return { master: { response: `❌ Error explaining: ${e.message}` }};
  }
}

// ============================================================================
// #6 & #14: TOOL CHAINING & PARALLEL EXECUTION
// ============================================================================

// Execute multiple actions in parallel or sequence
async function executeActionChain(actions, userId) {
  const results = [];

  // Separate into parallel-safe and sequential actions
  const parallelSafe = actions.filter(a => ['READ', 'FILES', 'SEARCH', 'WEB_SEARCH'].includes(a.action));
  const sequential = actions.filter(a => !['READ', 'FILES', 'SEARCH', 'WEB_SEARCH'].includes(a.action));

  // Execute parallel-safe actions concurrently (#14)
  if (parallelSafe.length > 0) {
    const parallelResults = await Promise.allSettled(
      parallelSafe.map(action => executeSingleAction(action, userId))
    );
    for (let i = 0; i < parallelResults.length; i++) {
      const result = parallelResults[i];
      results.push({
        action: parallelSafe[i].action,
        success: result.status === 'fulfilled',
        result: result.status === 'fulfilled' ? result.value : result.reason?.message
      });
    }
  }

  // Execute sequential actions one by one
  for (const action of sequential) {
    try {
      const result = await executeSingleAction(action, userId);
      results.push({ action: action.action, success: true, result });
    } catch (e) {
      results.push({ action: action.action, success: false, result: e.message });
    }
  }

  return results;
}

// Execute a single action
async function executeSingleAction(action, userId) {
  switch (action.action) {
    case 'READ':
      return await github.readFile(
        action.params.owner || 'sabriotcore-code',
        action.params.repo,
        action.params.path
      );
    case 'FILES':
      return await github.listFiles(
        action.params.owner || 'sabriotcore-code',
        action.params.repo,
        action.params.path || ''
      );
    case 'SEARCH':
      return await github.searchCode(action.params.query);
    case 'WEB_SEARCH':
      return await web.search(action.params.query);
    case 'COMMIT_FILE':
      const existing = await github.readFile(
        action.params.owner || 'sabriotcore-code',
        action.params.repo,
        action.params.path
      ).catch(() => null);
      return await github.createOrUpdateFile(
        action.params.owner || 'sabriotcore-code',
        action.params.repo,
        action.params.path,
        action.params.content,
        action.params.message || 'Update via bot',
        existing?.sha
      );
    default:
      throw new Error(`Unknown action: ${action.action}`);
  }
}

// Detect if query needs multiple actions (#6)
function detectMultipleActions(query) {
  const chainKeywords = [' and ', ' then ', ' also ', ', then ', ' after that '];
  const hasChain = chainKeywords.some(k => query.toLowerCase().includes(k));

  if (!hasChain) return null;

  // Split and identify sub-tasks
  const parts = query.split(/\s+(?:and|then|also)\s+/i).filter(p => p.trim());
  if (parts.length <= 1) return null;

  return parts;
}

// ============================================================================
// #5: ERROR RECOVERY - Using imported withRetry from helpers.js
// ============================================================================

// ============================================================================
// MASTER AI COMMAND HANDLER
// ============================================================================

async function handleMasterCommand(query, userId = 'default') {
  // ============================================================
  // RATE LIMITING - Prevent abuse
  // ============================================================
  const rateCheck = checkRateLimit(`user_${usernameToId(userId)}`, 30, 60000); // 30 requests per minute
  if (!rateCheck.allowed) {
    return { master: { response: `⏳ *Rate limit exceeded.* Please wait ${Math.ceil(rateCheck.resetIn / 1000)} seconds before trying again.` }};
  }

  // ============================================================
  // FORCE & BATCH MODE - Bypass confirmations
  // ============================================================
  const normalizedUserId = usernameToId(userId);

  // Check for --force flag
  const hasForceFlag = query.includes('--force') || query.includes('-f');
  let cleanQuery = query.replace(/\s*(--force|-f)\s*/g, ' ').trim();

  // Check for batch mode commands
  const batchMatch = cleanQuery.match(/^batch\s+(on|off|status)$/i);
  if (batchMatch) {
    const batchAction = batchMatch[1].toLowerCase();
    if (batchAction === 'on') {
      await memory.store(`batch_mode_${normalizedUserId}`, 'true', 'settings');
      return { master: { response: `🚀 *Batch Mode ENABLED*\n\nAll confirmations will be auto-approved.\nRisky file warnings will be logged but not block execution.\n\n⚠️ Use with caution! Run \`batch off\` when done.` }};
    } else if (batchAction === 'off') {
      await memory.store(`batch_mode_${normalizedUserId}`, '', 'settings');
      return { master: { response: `🛡️ *Batch Mode DISABLED*\n\nNormal confirmation flow restored.` }};
    } else {
      const batchState = await memory.retrieve(`batch_mode_${normalizedUserId}`);
      return { master: { response: `📊 *Batch Mode:* ${batchState.value ? 'ON 🚀' : 'OFF 🛡️'}` }};
    }
  }

  // Check if batch mode is active
  const batchModeState = await memory.retrieve(`batch_mode_${normalizedUserId}`);
  const isBatchMode = batchModeState.value === 'true';
  const forceMode = hasForceFlag || isBatchMode;

  // Use cleaned query for further processing
  query = cleanQuery;

  // ============================================================
  // SMART CONTEXT SYSTEM - Makes the bot context-aware like Claude Code
  // ============================================================

  // Get pending state (was there a plan just shown?) - use normalized userId
  const pendingState = await memory.retrieve(`pending_${normalizedUserId}`);
  const lastResponse = await memory.retrieve(`last_response_${normalizedUserId}`);

  // PRE-INTENT SHORTCUTS - Catch obvious patterns before calling Claude
  const queryLower = query.toLowerCase().trim();

  // Check if this is a confirmation of a pending action
  if (pendingState.value && ['yes', 'y', 'do it', 'proceed', 'go', 'go ahead', 'confirm', 'execute', 'run it', 'ok', 'okay', 'sure', 'yep', 'yeah', 'affirmative'].includes(queryLower)) {
    // Clear the pending state
    await memory.store(`pending_${userId}`, '', 'state');

    // Check what type of pending action we have
    if (pendingState.value === 'PLAN') {
      // Execute the stored plan
      return await executePendingPlan(userId);
    } else if (pendingState.value === 'COMMIT') {
      // Execute the pending commit
      const pendingCommit = await memory.retrieve(`pending_commit_${userId}`);
      if (pendingCommit.value) {
        try {
          const commit = JSON.parse(pendingCommit.value);
          const result = await github.createOrUpdateFile(
            commit.owner,
            commit.repo,
            commit.path,
            commit.content,
            commit.message,
            commit.sha,
            userId
          );
          await memory.store(`pending_commit_${userId}`, '', 'pending');
          await context.updateContext('CURRENT WORK', `Committed ${commit.path} to ${commit.repo}`);
          return { master: { response: `✅ *File Committed!*\n📁 \`${commit.path}\`\n📦 Repo: ${commit.owner}/${commit.repo}\n📝 Message: ${commit.message}\n🔗 ${result.content?.html_url || 'Commit successful'}\n\n_Use /history to see changes. Use /rollback to undo._` }};
        } catch (e) {
          return { master: { response: `❌ Commit failed: ${e.message}` }};
        }
      }
      return { master: { response: `❌ No pending commit found.` }};
    } else if (pendingState.value === 'CONFIRM') {
      // Generic confirmation - execute whatever was pending
      return { master: { response: `✅ Confirmed! Proceeding with the action.` }};
    }
  }

  // Check if this is a rejection
  if (pendingState.value && ['no', 'n', 'cancel', 'stop', 'nevermind', 'never mind', 'abort', 'nope', 'nah'].includes(queryLower)) {
    await memory.store(`pending_${userId}`, '', 'state');
    await memory.store(`plan_${userId}`, '', 'plans');
    return { master: { response: `❌ Cancelled. What would you like to do instead?` }};
  }

  // Check for help/status queries
  if (['help', '?', 'what can you do', 'commands', 'options'].includes(queryLower)) {
    return getHelpResponse();
  }

  // ============================================================
  // #12: SMARTER INTENT ROUTING - Pattern match before Claude
  // ============================================================

  // Quick pattern matching for common commands (saves Claude calls)
  if (queryLower === 'repos' || queryLower === 'show repos' || queryLower === 'my repos' || queryLower === 'list repos') {
    const repos = await github.listRepos(20);
    return { repos };
  }

  if (queryLower.startsWith('explain ') || queryLower.startsWith('what does ') || queryLower.startsWith('how does ')) {
    // #15: Code Explanation Mode - route to EXPLAIN action
    const target = query.replace(/^(explain|what does|how does)\s+/i, '').trim();
    return await explainCode(target, userId);
  }

  if (queryLower === 'status' || queryLower === 'health') {
    const health = {
      core: {
        ...ai.getProviderStatus(),
        github: github.isConfigured(),
        web: web.isConfigured(),
        google: google.isConfigured()
      },
      ai: {
        googleAI: googleAI.getStatus(),
        providers: aiProviders.getProviderStatus()
      },
      data: vectorDb.getStatus(),
      devops: devops.getStatus(),
      business: business.getStatus(),
      security: security.getStatus(),
      smart: smart.getStatus()
    };
    return { health };
  }

  // ============================================================
  // GOOGLE AI COMMANDS - Smart AI features
  // ============================================================

  // Semantic code search: "search for error handling code"
  if (queryLower.startsWith('search ') || queryLower.startsWith('find code ') || queryLower.startsWith('semantic ')) {
    const searchQuery = query.replace(/^(search|find code|semantic)\s+(for\s+)?/i, '').trim();
    try {
      // Get repo files to search
      const repoMatch = searchQuery.match(/in\s+(\S+)/);
      const targetRepo = repoMatch ? repoMatch[1] : 'cloud-orchestrator';
      const cleanQuery = searchQuery.replace(/in\s+\S+/i, '').trim();

      const files = await github.listRepoFiles('sabriotcore-code', targetRepo);
      const codeFiles = files.filter(f => /\.(js|ts|jsx|tsx|py|go|rs)$/.test(f.path)).slice(0, 20);

      // Read and index files
      const fileContents = await Promise.all(
        codeFiles.map(async f => {
          try {
            const content = await github.readFile('sabriotcore-code', targetRepo, f.path);
            return { path: f.path, content: content.content };
          } catch (e) {
            return null;
          }
        })
      );

      const validFiles = fileContents.filter(f => f && f.content);

      // Semantic search
      const searchItems = validFiles.map(f => ({
        id: f.path,
        text: f.content.substring(0, 2000),
        metadata: { path: f.path }
      }));

      const results = await googleAI.semanticSearch(cleanQuery, searchItems, 5);

      let response = `🔍 *Semantic Search Results for:* "${cleanQuery}"\n\n`;
      for (const result of results) {
        response += `📁 \`${result.id}\` (${Math.round(result.score * 100)}% match)\n`;
      }

      return { master: { response }};
    } catch (e) {
      return { master: { response: `❌ Search failed: ${e.message}` }};
    }
  }

  // Code review: "review src/services/slack.js"
  if (queryLower.startsWith('review ')) {
    const filePath = query.replace(/^review\s+/i, '').trim();
    try {
      const pathParts = filePath.split('/');
      const repo = pathParts[0] || 'cloud-orchestrator';
      const path = pathParts.slice(1).join('/') || filePath;

      const file = await github.readFile('sabriotcore-code', repo, path);
      const review = await googleAI.reviewCode(file.content);

      let response = `📝 *Code Review: ${path}*\n\n`;
      response += `⭐ *Score:* ${review.overallScore}/10\n\n`;

      if (review.bugs?.length > 0) {
        response += `🐛 *Bugs:*\n`;
        for (const bug of review.bugs.slice(0, 5)) {
          response += `• L${bug.line}: [${bug.severity}] ${bug.description}\n`;
        }
        response += '\n';
      }

      if (review.security?.length > 0) {
        response += `🔒 *Security:*\n`;
        for (const sec of review.security.slice(0, 3)) {
          response += `• L${sec.line}: ${sec.description}\n`;
        }
        response += '\n';
      }

      if (review.improvements?.length > 0) {
        response += `💡 *Improvements:*\n`;
        for (const imp of review.improvements.slice(0, 5)) {
          response += `• ${imp}\n`;
        }
      }

      return { master: { response }};
    } catch (e) {
      return { master: { response: `❌ Review failed: ${e.message}` }};
    }
  }

  // Generate code: "generate a function to validate emails"
  if (queryLower.startsWith('generate ') || queryLower.startsWith('write code ') || queryLower.startsWith('create code ')) {
    const description = query.replace(/^(generate|write code|create code)\s+/i, '').trim();
    try {
      const code = await googleAI.generateCode(description);
      return { master: { response: `🔨 *Generated Code:*\n\n${code}` }};
    } catch (e) {
      return { master: { response: `❌ Generation failed: ${e.message}` }};
    }
  }

  // Summarize: "summarize the README"
  if (queryLower.startsWith('summarize ')) {
    const target = query.replace(/^summarize\s+/i, '').trim();
    try {
      // Check if it's a URL or file
      if (target.startsWith('http')) {
        const result = await googleAI.fetchAndAnalyze(target, 'Provide a comprehensive summary');
        return { master: { response: `📄 *Summary of ${target}:*\n\n${result.answer || result.error}` }};
      } else {
        const file = await github.readFile('sabriotcore-code', 'cloud-orchestrator', target);
        const summary = await googleAI.summarizeDocument(file.content, 'bullets');
        return { master: { response: `📄 *Summary of ${target}:*\n\n${summary}` }};
      }
    } catch (e) {
      return { master: { response: `❌ Summary failed: ${e.message}` }};
    }
  }

  // Intent check: "intent: what does user want"
  if (queryLower.startsWith('intent:') || queryLower.startsWith('classify ')) {
    const text = query.replace(/^(intent:|classify)\s*/i, '').trim();
    try {
      const intent = await googleAI.classifyIntent(text);
      return { master: { response: `🎯 *Intent Classification:*\n\n• Intent: \`${intent.intent}\`\n• Confidence: ${Math.round(intent.confidence * 100)}%\n• Summary: ${intent.summary}\n• Entities: ${JSON.stringify(intent.entities)}` }};
    } catch (e) {
      return { master: { response: `❌ Classification failed: ${e.message}` }};
    }
  }

  // Sentiment analysis: "sentiment: user feedback text"
  if (queryLower.startsWith('sentiment:') || queryLower.startsWith('analyze sentiment ')) {
    const text = query.replace(/^(sentiment:|analyze sentiment)\s*/i, '').trim();
    try {
      const sentiment = await googleAI.analyzeSentiment(text);
      const emoji = sentiment.score > 0.2 ? '😊' : sentiment.score < -0.2 ? '😟' : '😐';
      return { master: { response: `${emoji} *Sentiment Analysis:*\n\n• Label: ${sentiment.label}\n• Score: ${sentiment.score.toFixed(2)} (-1 to 1)\n• Magnitude: ${sentiment.magnitude.toFixed(2)}` }};
    } catch (e) {
      return { master: { response: `❌ Sentiment analysis failed: ${e.message}` }};
    }
  }

  // History shortcut: "history", "history rei-dashboard", "show changes"
  if (queryLower.startsWith('history') || queryLower.includes('show changes') || queryLower.includes('recent changes')) {
    const repoMatch = query.match(/\b(rei-dashboard|cloud-orchestrator|ai-orchestrator|rei-automation)\b/i);
    const repo = repoMatch ? repoMatch[1].toLowerCase() : 'cloud-orchestrator';
    const changes = await github.getChangeHistory('sabriotcore-code', repo, 10);
    if (changes.length === 0) {
      return { master: { response: `📜 *No changes recorded yet for ${repo}*\n\nChanges will appear here after the bot makes commits.` }};
    }
    return { master: { response: `📜 *Recent Bot Changes to ${repo}:*\n\n${github.formatChangeHistory(changes)}\n\n_Use "rollback <repo> <file> <changeId>" to undo_` }};
  }

  // Rollback shortcut: "rollback rei-dashboard index.html change_xxx"
  if (queryLower.startsWith('rollback ')) {
    const parts = query.replace(/^rollback\s+/i, '').trim().split(/\s+/);
    const repo = parts[0] || '';
    const file = parts[1] || '';
    const changeId = parts[2] || '';

    if (!repo) {
      return { master: { response: `❌ Usage: rollback <repo> <file> [changeId]\n\nExample: rollback rei-dashboard index.html\n\nFirst run "history <repo>" to see available changes.` }};
    }

    try {
      if (changeId) {
        // Execute rollback
        await github.rollbackFile('sabriotcore-code', repo, file, changeId, userId);
        return { master: { response: `✅ *Rolled back ${file}!*\n\nThe file has been restored to its previous version.` }};
      } else if (file) {
        // Show versions for this file
        const changes = await github.getChangeHistory('sabriotcore-code', repo, 20);
        const fileChanges = changes.filter(c => c.path === file && c.oldContent);
        if (fileChanges.length === 0) {
          return { master: { response: `❌ No rollback versions found for ${file}` }};
        }
        return { master: { response: `📜 *Available versions for ${file}:*\n\n${fileChanges.slice(0, 5).map(c => `• \`${c.id}\` - ${c.message} (${new Date(c.timestamp).toLocaleString()})`).join('\n')}\n\n_Use "rollback ${repo} ${file} <changeId>" to restore_` }};
      } else {
        // Show all changes for repo
        const changes = await github.getChangeHistory('sabriotcore-code', repo, 10);
        return { master: { response: `📜 *Recent changes to ${repo}:*\n\n${github.formatChangeHistory(changes)}\n\n_Specify a file to see rollback options_` }};
      }
    } catch (e) {
      return { master: { response: `❌ Rollback failed: ${e.message}` }};
    }
  }

  // ============================================================
  // #7: PROACTIVE CONTEXT LOADING - Auto-fetch mentioned files
  // ============================================================

  let proactiveContext = '';

  // Check if user mentions a specific file
  const fileMatch = queryLower.match(/\b([\w-]+\.(js|html|css|json|md|ts|py))\b/);
  if (fileMatch) {
    const fileName = fileMatch[1];
    // Try to find and read this file
    try {
      for (const repo of ['cloud-orchestrator', 'rei-dashboard', 'rei-automation']) {
        try {
          const file = await github.readFile('sabriotcore-code', repo, fileName);
          proactiveContext += `\n[Auto-loaded ${fileName} from ${repo}]: ${file.content.substring(0, 1000)}...\n`;
          break;
        } catch (e) { /* try next repo */ }
      }
    } catch (e) { /* ignore */ }
  }

  // Check if user mentions a specific repo
  const repoMentioned = queryLower.match(/\b(rei-dashboard|cloud-orchestrator|ai-orchestrator|rei-automation)\b/);
  if (repoMentioned && !proactiveContext) {
    try {
      const files = await github.listFiles('sabriotcore-code', repoMentioned[1], '');
      proactiveContext += `\n[Auto-loaded ${repoMentioned[1]} structure]: ${files.map(f => f.name).join(', ')}\n`;
    } catch (e) { /* ignore */ }
  }

  if (!query) {
    return { master: {
      response: `🤖 *AI Orchestrator - Available Actions:*\n\n` +
        `*GitHub:*\n` +
        `• "show my repos"\n` +
        `• "what files are in cloud-orchestrator"\n` +
        `• "read package.json from cloud-orchestrator"\n` +
        `• "show commits for cloud-orchestrator"\n` +
        `• "create issue in cloud-orchestrator: title here"\n` +
        `• "search for askClaude in my code"\n\n` +
        `*AI:*\n` +
        `• "ask all 3 AIs: what is the best language"\n` +
        `• "review this code: function add(a,b){return a+b}"\n` +
        `• "challenge this approach: using REST API"\n\n` +
        `*Web:*\n` +
        `• "search the web for nodejs best practices"\n` +
        `• "what is the weather in New York"\n\n` +
        `*Sheets:*\n` +
        `• "read sheet 1MBGc... range A1:D10"\n\n` +
        `*Memory:*\n` +
        `• "remember that the API key is XYZ"\n` +
        `• "what do you remember about API"\n`
    }};
  }

  // Store user message in memory
  await memory.remember(userId, 'user', query);

  // Get RICHER conversation context (more messages)
  const conversationContext = await memory.getContextString(userId, 8);

  // Get the last bot response for immediate context
  const lastBotResponse = lastResponse.value || '';

  // Get master context summary
  const masterContextSummary = await context.getContextSummary();

  // =========================================================================
  // RAG + MEM0 CONTEXT RETRIEVAL (Intelligence Enhancement)
  // =========================================================================
  let ragContext = '';
  let mem0Context = '';

  // 1. Enhanced RAG - retrieve relevant knowledge from all sources
  try {
    const ragResult = await enhancedRag.enhancedRAG(query, {
      sources: ['memory', 'conversations'],
      topK: 5,
      decompose: true,
      rerank: true
    });
    if (ragResult && ragResult.context) {
      ragContext = ragResult.context;
      console.log(`[RAG] Retrieved ${ragResult.results?.length || 0} relevant chunks`);
    }
  } catch (e) {
    console.log('[RAG] Context retrieval failed:', e.message);
  }

  // 2. Mem0 Long-term Memory - retrieve semantic memories
  try {
    const memResult = await mem0.getContext(userId, query, { limit: 5 });
    if (memResult && (memResult.relevant?.length || memResult.recent?.length)) {
      const relevantMems = (memResult.relevant || []).map(m => `• ${m.memory || m.text || m}`).join('\n');
      const recentMems = (memResult.recent || []).map(m => `• ${m.memory || m.text || m}`).join('\n');
      if (relevantMems) mem0Context += `Related memories:\n${relevantMems}\n`;
      if (recentMems) mem0Context += `Recent memories:\n${recentMems}`;
      console.log(`[Mem0] Retrieved ${memResult.relevant?.length || 0} relevant, ${memResult.recent?.length || 0} recent memories`);
    }
  } catch (e) {
    console.log('[Mem0] Memory retrieval failed:', e.message);
  }
  // =========================================================================

  // Build context about current state
  const stateContext = pendingState.value
    ? `\n⚠️ IMPORTANT: There is a pending ${pendingState.value} awaiting user response.\n`
    : '';

  // Use Claude to understand intent and extract parameters
  const intentPrompt = `You are a smart command router. Analyze this user request and determine what action to take.
${stateContext}
IMPORTANT RULES:
1. If the user asks "what does X do", "what is X", "explain X", "describe X", "tell me about X" - use ASK_AI with the question. These are QUESTIONS, not file operations.
2. Only use FILES/READ when user explicitly asks to "list files", "show files", "read file", "open file"
3. For questions about projects, repos, or services - use ASK_AI and include context from previous messages
4. When in doubt, use ASK_AI - it's better to answer intelligently than list files

Available actions:
- REPOS: List user's GitHub repositories (ONLY when asked to "list repos", "show repos", "my repos")
- FILES: List files in a repo (ONLY when asked to "list files", "show files in")
- READ: Read a file (ONLY when asked to "read file", "show contents of", "open file")
- COMMITS: Show commits (when asked for "commits", "recent changes", "history")
- ISSUES: Show issues (when asked for "issues", "bugs", "tickets")
- CREATE_ISSUE: Create a GitHub issue (when asked to "create issue", "open issue", "report bug")
- SEARCH: Search code (when asked to "search code", "find in code", "where is")
- WEB_SEARCH: Search the web (when asked to "search web", "google", "look up online")
- READ_SHEET: Read Google Sheet (when given a sheet ID or asked about spreadsheet)
- ASK_AI: Ask a question - USE THIS FOR ANY QUESTION including "what does X do", "explain", "describe", "why", "how"
- REVIEW: Code review (when given code to review)
- CHALLENGE: Challenge an approach (when asked to challenge or critique)
- REMEMBER: Store something in memory (when asked to "remember", "save", "store")
- RECALL: Retrieve from memory (when asked to "recall", "what did I say about")
- HISTORY: Show conversation history
- UPDATE_CONTEXT: Update master context file (when asked to "log this", "add to context", "update status")
- GET_CONTEXT: Show current master context/status

EXECUTABLE ACTIONS (these actually DO things):
- COMMIT_FILE: Create or update a file in a repo (when asked to "create file", "add file", "update file", "commit", "push")
- CREATE_PR: Create a pull request (when asked to "create PR", "open pull request", "make PR")
- DEPLOY: Trigger deployment by pushing to master (when asked to "deploy", "push changes", "go live")
- EXECUTE_PLAN: Generate and execute a multi-step plan (when asked to "do X", "migrate", "move", "set up", complex tasks)
- CONFIRM_PLAN: User confirms they want to execute the previously shown plan (when user says "yes", "do it", "proceed", "execute", "go ahead", "confirm", "run it")

=== MASTER CONTEXT (What I know about Matt's projects) ===
${masterContextSummary}
===

${lastBotResponse ? `My last response to user:\n${lastBotResponse}\n` : ''}
${conversationContext ? `Recent conversation history:\n${conversationContext}\n` : ''}
${proactiveContext ? `Auto-loaded context:\n${proactiveContext}\n` : ''}

User's current request: "${query}"

Known repos and what they do:
- sabriotcore-code/cloud-orchestrator: Multi-AI orchestration system with Slack bot, queries Claude/GPT/Gemini
- sabriotcore-code/rei-dashboard: Real estate investment dashboard hosted on Netlify
- sabriotcore-code/ai-orchestrator: Local AI orchestrator (older version)
- sabriotcore-code/rei-automation: Real estate automation scripts

Respond with ONLY a JSON object (no markdown, no explanation):
{"action": "ACTION_NAME", "params": {"key": "value"}}

Examples:
- "show my repos" → {"action": "REPOS", "params": {}}
- "list files in cloud-orchestrator" → {"action": "FILES", "params": {"owner": "sabriotcore-code", "repo": "cloud-orchestrator", "path": ""}}
- "what does rei-dashboard do" → {"action": "ASK_AI", "params": {"question": "What does the rei-dashboard project do?"}}
- "search the web for nodejs" → {"action": "WEB_SEARCH", "params": {"query": "nodejs"}}
- "create file README.md in rei-dashboard with hello world" → {"action": "COMMIT_FILE", "params": {"owner": "sabriotcore-code", "repo": "rei-dashboard", "path": "README.md", "content": "# Hello World", "message": "Add README"}}
- "deploy rei-dashboard" → {"action": "DEPLOY", "params": {"repo": "rei-dashboard", "message": "Deploy via Slack"}}
- "migrate rei-dashboard to Railway" → {"action": "EXECUTE_PLAN", "params": {"task": "migrate rei-dashboard to Railway", "steps": []}}
- "create PR in cloud-orchestrator with title Fix bug" → {"action": "CREATE_PR", "params": {"owner": "sabriotcore-code", "repo": "cloud-orchestrator", "title": "Fix bug", "branch": "fix-bug"}}
- "yes" → {"action": "CONFIRM_PLAN", "params": {}}
- "do it" → {"action": "CONFIRM_PLAN", "params": {}}
- "proceed" → {"action": "CONFIRM_PLAN", "params": {}}
- "execute the plan" → {"action": "CONFIRM_PLAN", "params": {}}`;

  const intentResult = await ai.askClaude(intentPrompt, '');

  if (!intentResult.success) {
    return { master: { response: `❌ Failed to understand request: ${intentResult.error}` }};
  }

  // Parse the intent
  let intent;
  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = intentResult.response.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    }
    intent = JSON.parse(jsonStr);
  } catch (e) {
    // If parsing fails, treat as a general AI question
    intent = { action: 'ASK_AI', params: { question: query }};
  }

  // Execute the action
  try {
    switch (intent.action) {
      case 'REPOS':
        const repos = await github.listRepos(20);
        return { repos };

      case 'FILES':
        const files = await github.listFiles(
          intent.params.owner || 'sabriotcore-code',
          intent.params.repo || 'cloud-orchestrator',
          intent.params.path || ''
        );
        return { files, path: intent.params.path || 'root' };

      case 'READ':
        const file = await github.readFile(
          intent.params.owner || 'sabriotcore-code',
          intent.params.repo,
          intent.params.filepath
        );
        return { file };

      case 'COMMITS':
        const commits = await github.getCommits(
          intent.params.owner || 'sabriotcore-code',
          intent.params.repo || 'cloud-orchestrator',
          10
        );
        return { commits };

      case 'ISSUES':
        const issues = await github.listIssues(
          intent.params.owner || 'sabriotcore-code',
          intent.params.repo || 'cloud-orchestrator',
          'open',
          15
        );
        return { issues };

      case 'SEARCH':
        const search = await github.searchCode(intent.params.query, 10);
        return { search, query: intent.params.query };

      case 'CREATE_ISSUE':
        const newIssue = await github.createIssue(
          intent.params.owner || 'sabriotcore-code',
          intent.params.repo || 'cloud-orchestrator',
          intent.params.title,
          intent.params.body || ''
        );
        return { master: { response: `✅ *Issue Created:* #${newIssue.number}\n${newIssue.url}` }};

      case 'WEB_SEARCH':
        const webResults = await web.search(intent.params.query);
        if (!webResults.success || webResults.results.length === 0) {
          // Fallback to AI if no web results
          const aiAnswer = await ai.askAll(intent.params.query, 'general');
          const aiConsensus = await ai.buildConsensus(aiAnswer, 'weighted');
          const response = `🌐 *Web search found no direct results, here's what the AIs say:*\n\n${aiConsensus.response}`;
          await memory.remember(userId, 'assistant', response);
          return { master: { response }};
        }
        let webText = `🌐 *Web Search: "${intent.params.query}"*\n\n`;
        for (const r of webResults.results.slice(0, 5)) {
          webText += `• *${r.title}*\n  ${r.snippet.substring(0, 200)}\n`;
          if (r.url) webText += `  ${r.url}\n`;
          webText += '\n';
        }
        await memory.remember(userId, 'assistant', webText);
        return { master: { response: webText }};

      case 'READ_SHEET':
        const sheetData = await google.quickReadSheet(
          intent.params.spreadsheetId,
          intent.params.range || 'Sheet1!A1:Z50'
        );
        if (!sheetData.success) {
          return { master: { response: `❌ ${sheetData.error}` }};
        }
        let sheetText = `📊 *Sheet Data* (${sheetData.rowCount} rows):\n\`\`\`\n`;
        for (const row of sheetData.values.slice(0, 20)) {
          sheetText += row.join(' | ') + '\n';
        }
        sheetText += '```';
        return { master: { response: sheetText }};

      case 'REMEMBER':
        await memory.store(intent.params.key, intent.params.value, 'user');
        const rememberResponse = `✅ Remembered: *${intent.params.key}* = "${intent.params.value}"`;
        await memory.remember(userId, 'assistant', rememberResponse);
        return { master: { response: rememberResponse }};

      case 'RECALL':
        const recalled = await memory.retrieve(intent.params.key);
        if (recalled.value) {
          return { master: { response: `🧠 *${intent.params.key}:* ${recalled.value}` }};
        }
        return { master: { response: `🧠 I don't have anything stored for "${intent.params.key}"` }};

      case 'HISTORY':
        const history = await memory.recall(userId, 10);
        if (!history.success || history.messages.length === 0) {
          return { master: { response: `📜 No conversation history yet.` }};
        }
        let historyText = `📜 *Recent Conversation:*\n\n`;
        for (const m of history.messages) {
          const icon = m.role === 'user' ? '👤' : '🤖';
          historyText += `${icon} ${m.content.substring(0, 100)}...\n`;
        }
        return { master: { response: historyText }};

      case 'UPDATE_CONTEXT':
        const section = intent.params.section || 'CURRENT WORK';
        const updateContent = intent.params.content || query;
        const updateResult = await context.updateContext(section, updateContent);
        if (updateResult.success) {
          return { master: { response: `✅ Master context updated!\nSection: ${section}\nContent: ${updateContent}` }};
        }
        return { master: { response: `❌ Failed to update context: ${updateResult.error}` }};

      case 'GET_CONTEXT':
        const currentContext = await context.getContextSummary();
        return { master: { response: `📋 *Current Master Context:*\n\n${currentContext.substring(0, 2500)}` }};

      // ================== EXECUTABLE ACTIONS ==================

      case 'COMMIT_FILE':
        // Create or update a file in a repo - WITH RISK CHECK
        try {
          const commitOwner = intent.params.owner || 'sabriotcore-code';
          const commitRepo = intent.params.repo;
          const commitPath = intent.params.path;
          const commitContent = intent.params.content;
          const commitMessage = intent.params.message || `Update ${commitPath} via Slack`;

          if (!commitRepo || !commitPath || !commitContent) {
            return { master: { response: `❌ Missing required params. Need: repo, path, content` }};
          }

          // RISK CHECK - detect risky changes using helper
          const isRisky = isRiskyFile(commitPath);

          // Check if we're deleting a lot of content
          let existingContent = null;
          let existingSha = null;
          try {
            const existing = await github.readFile(commitOwner, commitRepo, commitPath);
            existingSha = existing.sha;
            existingContent = existing.content;
          } catch (e) {
            // File doesn't exist, that's fine for creating
          }

          const isLargeDeletion = existingContent &&
            (commitContent.length < existingContent.length * 0.5); // More than 50% reduction

          // If risky, ask for confirmation (unless already confirmed OR forceMode is active)
          if ((isRisky || isLargeDeletion) && !intent.params.confirmed && !forceMode) {
            const riskWarnings = [];
            if (isRisky) riskWarnings.push(`⚠️ \`${commitPath}\` is a critical file`);
            if (isLargeDeletion) riskWarnings.push(`⚠️ This removes ${Math.round((1 - commitContent.length/existingContent.length) * 100)}% of the file content`);

            // Store pending change for confirmation
            await memory.store(`pending_commit_${usernameToId(userId)}`, JSON.stringify({
              owner: commitOwner,
              repo: commitRepo,
              path: commitPath,
              content: commitContent,
              message: commitMessage,
              sha: existingSha
            }), 'pending');

            await memory.store(`pending_${usernameToId(userId)}`, 'COMMIT', 'state');

            return { master: { response: `🛡️ *Risky Change Detected*\n\n${riskWarnings.join('\n')}\n\n📁 File: \`${commitPath}\`\n📦 Repo: ${commitOwner}/${commitRepo}\n\n**Reply "yes" or "confirm" to proceed, or "no" to cancel.**\n\n_Tip: Use \`--force\` or \`batch on\` to skip confirmations._` }};
          }

          // Log if force mode bypassed a risky check
          if ((isRisky || isLargeDeletion) && forceMode) {
            console.log(`[FORCE MODE] Bypassed risk check for ${commitPath} (user: ${userId})`);
          }

          const result = await github.createOrUpdateFile(
            commitOwner,
            commitRepo,
            commitPath,
            commitContent,
            commitMessage,
            existingSha,
            userId || 'bot'
          );

          await context.updateContext('CURRENT WORK', `Committed ${commitPath} to ${commitRepo}`);

          return { master: { response: `✅ *File Committed!*\n📁 \`${commitPath}\`\n📦 Repo: ${commitOwner}/${commitRepo}\n📝 Message: ${commitMessage}\n🔗 ${result.content?.html_url || 'Commit successful'}\n\n_Use /history ${commitOwner}/${commitRepo} to see changes. Use /rollback to undo._` }};
        } catch (e) {
          return { master: { response: `❌ Failed to commit: ${e.message}` }};
        }

      case 'CREATE_PR':
        // Create a pull request (note: requires branch to exist with changes)
        return { master: { response: `⚠️ *Create PR requires a branch with changes.*\n\nTo create a PR:\n1. First use COMMIT_FILE to add changes to a new branch\n2. Then create the PR\n\nOr use the GitHub web interface for complex PRs.` }};

      case 'DEPLOY':
        // Trigger deployment - for Railway, pushing to master auto-deploys
        try {
          const deployRepo = intent.params.repo || 'cloud-orchestrator';
          const deployOwner = intent.params.owner || 'sabriotcore-code';
          const deployMessage = intent.params.message || 'Deploy triggered via Slack';

          // For Railway: pushing to master triggers deploy
          // We'll update a deploy timestamp file to trigger a new deploy
          const timestamp = new Date().toISOString();
          const deployContent = `# Deploy Log\nLast deployed: ${timestamp}\nTriggered by: Slack /do command\nMessage: ${deployMessage}\n`;

          let deploySha = null;
          try {
            const existing = await github.readFile(deployOwner, deployRepo, '.deploy-log');
            deploySha = existing.sha;
          } catch (e) {
            // File doesn't exist
          }

          await github.createOrUpdateFile(
            deployOwner,
            deployRepo,
            '.deploy-log',
            deployContent,
            `Deploy: ${deployMessage}`,
            deploySha
          );

          await context.updateContext('CURRENT WORK', `Deployed ${deployRepo}`);

          return { master: { response: `🚀 *Deployment Triggered!*\n📦 Repo: ${deployOwner}/${deployRepo}\n⏰ Time: ${timestamp}\n📝 Message: ${deployMessage}\n\n_Railway will auto-deploy from master in ~30 seconds._` }};
        } catch (e) {
          return { master: { response: `❌ Failed to deploy: ${e.message}` }};
        }

      case 'EXECUTE_PLAN':
        // ================================================================
        // SMART EXECUTION: Plan → Investigate → Analyze → Auto-Execute
        // ================================================================
        try {
          const task = intent.params.task || query;
          let response = '';

          // ========== PHASE 0: HIERARCHICAL PLANNING ==========
          // For complex multi-step tasks, decompose into sub-tasks first
          const taskComplexity = reasoning.assessComplexity(task);
          console.log(`[EXECUTE_PLAN] Task complexity: ${taskComplexity.level}`);

          let executionPlan = null;
          if (taskComplexity.level === 'high' || task.toLowerCase().includes('migrate') ||
              task.toLowerCase().includes('refactor') || task.toLowerCase().includes('implement')) {
            response += `📋 *Creating Execution Plan...*\n\n`;
            try {
              executionPlan = await planner.createExecutionPlan(task, {
                context: { masterContext: await context.getContextSummary() }
              });

              if (executionPlan.tasks && executionPlan.tasks.length > 0) {
                response += `*📝 Hierarchical Plan:*\n`;
                for (const t of executionPlan.tasks.slice(0, 8)) {
                  const icon = t.type === 'action' ? '🔧' : t.type === 'research' ? '🔍' : '📌';
                  response += `${icon} ${t.name} (${t.estimatedMinutes || '?'}min)\n`;
                }
                if (executionPlan.timeline) {
                  response += `\n⏱️ *Estimated:* ${executionPlan.timeline.totalHours}h\n`;
                }
                response += `\n`;

                // Save plan for tracking
                const saved = await planner.savePlan(executionPlan);
                response += `📌 Plan saved: \`${saved.planId}\`\n\n`;
              }
            } catch (e) {
              console.log('[EXECUTE_PLAN] Planning failed, continuing with investigation:', e.message);
            }
          }

          response += `🔍 *Investigating: ${task}*\n\n`;

          // ========== PHASE 0.5: ERROR PREDICTION (Self-Reflection) ==========
          // Predict potential errors based on past patterns
          const taskTypeForReflection = task.toLowerCase().includes('fix') ? 'code_fix' :
            task.toLowerCase().includes('deploy') ? 'deploy' :
            task.toLowerCase().includes('migrate') ? 'migration' : 'general';

          try {
            const errorPredictions = await reflection.predictErrors(taskTypeForReflection, task);
            if (errorPredictions && errorPredictions.length > 0) {
              response += `⚠️ *Known Risks (from past learning):*\n`;
              for (const pred of errorPredictions.slice(0, 3)) {
                response += `• ${pred.risk.toUpperCase()}: ${pred.prevention}\n`;
              }
              response += `\n`;
            }

            // Also get applicable lessons
            const lessons = await reflection.getApplicableLessons(taskTypeForReflection, task);
            if (lessons && lessons.length > 0) {
              response += `💡 *Lessons learned:*\n`;
              for (const lesson of lessons.slice(0, 2)) {
                response += `• ${lesson.lesson} (${(lesson.confidence * 100).toFixed(0)}% confident)\n`;
              }
              response += `\n`;
            }
          } catch (e) {
            console.log('[Reflection] Prediction failed:', e.message);
          }

          // ========== PHASE 1: INVESTIGATION ==========
          // Determine which repo and files are relevant
          const repoMatch = task.match(/\b(rei-dashboard|cloud-orchestrator|ai-orchestrator|rei-automation)\b/i);
          const targetRepo = repoMatch ? repoMatch[1].toLowerCase() : 'rei-dashboard';
          const targetOwner = 'sabriotcore-code';

          response += `📂 *Target:* ${targetOwner}/${targetRepo}\n\n`;

          // Read key files to understand the codebase
          let investigationData = {};
          let filesRead = [];

          try {
            // Get file list first
            const allFiles = await github.listFiles(targetOwner, targetRepo, '');
            const fileNames = allFiles.map(f => f.name).join(', ');
            investigationData.structure = fileNames;
            response += `📁 *Files found:* ${fileNames.substring(0, 200)}...\n`;

            // Read main files based on what we find - be more aggressive
            const filesToRead = [];
            for (const f of allFiles) {
              // Include all HTML, JS, CSS, and config files
              if (f.name.endsWith('.html') || f.name.endsWith('.js') ||
                  f.name.endsWith('.css') || f.name.endsWith('.json')) {
                filesToRead.push(f.name);
              }
            }

            // Also check src/, js/, scripts/, css/ folders
            for (const f of allFiles) {
              if (f.type === 'dir' && ['src', 'js', 'scripts', 'lib', 'css', 'styles', 'assets'].includes(f.name)) {
                try {
                  const subFiles = await github.listFiles(targetOwner, targetRepo, f.name);
                  for (const sf of subFiles) {
                    if (sf.name.endsWith('.js') || sf.name.endsWith('.html') || sf.name.endsWith('.css')) {
                      filesToRead.push(`${f.name}/${sf.name}`);
                    }
                  }
                } catch (e) { /* ignore */ }
              }
            }

            // Read up to 10 key files with more content (8000 chars each)
            for (const fileName of filesToRead.slice(0, 10)) {
              try {
                const fileContent = await github.readFile(targetOwner, targetRepo, fileName);
                // Read up to 8000 chars per file (enough for most files)
                investigationData[fileName] = fileContent.content.substring(0, 8000);
                filesRead.push(fileName);
              } catch (e) { /* ignore */ }
            }

            response += `📖 *Read ${filesRead.length} files:* ${filesRead.join(', ')}\n\n`;
          } catch (e) {
            response += `⚠️ Could not read files: ${e.message}\n\n`;
          }

          // ========== PHASE 2: ANALYSIS ==========
          response += `🧠 *Analyzing code...*\n\n`;

          // Get master context for known issues
          const ctx = await context.getContextSummary();

          // Build analysis prompt with REAL code
          const analysisPrompt = `You are a senior developer analyzing code to fix an issue.

TASK: ${task}

PROJECT CONTEXT:
${ctx}

FILES I READ FROM ${targetOwner}/${targetRepo}:
${Object.entries(investigationData).map(([name, content]) =>
  `=== ${name} ===\n${content}\n`
).join('\n')}

Based on the ACTUAL CODE above:
1. What is the specific problem?
2. What exact changes need to be made?
3. What are the file paths and line numbers?

Return JSON:
{
  "diagnosis": "what the problem is based on the code",
  "rootCause": "why this is happening",
  "fixes": [
    {
      "file": "path/to/file.js",
      "description": "what to change",
      "oldCode": "the problematic code snippet",
      "newCode": "the fixed code snippet",
      "safe": true/false
    }
  ],
  "canAutoFix": true/false,
  "manualSteps": ["anything requiring human action"]
}`;

          const analysisResult = await ai.askClaude(analysisPrompt, '');

          if (!analysisResult.success) {
            return { master: { response: response + `❌ Analysis failed: ${analysisResult.error}` }};
          }

          let analysis;
          try {
            // Use robust JSON extraction helper
            analysis = extractJson(analysisResult.response);

            if (!analysis) {
              throw new Error('No valid JSON found');
            }
          } catch (e) {
            // Fallback: try to extract key info manually
            const diagMatch = analysisResult.response.match(/"diagnosis":\s*"([^"]+)"/);
            const rootMatch = analysisResult.response.match(/"rootCause":\s*"([^"]+)"/);

            if (diagMatch || rootMatch) {
              // Partial parse - show what we got
              response += `*🔎 Diagnosis:* ${diagMatch ? diagMatch[1] : 'Could not extract'}\n\n`;
              response += `*🎯 Root Cause:* ${rootMatch ? rootMatch[1] : 'Could not extract'}\n\n`;
              response += `⚠️ *Could not fully parse fix details. Describe the specific fix you want.*`;
              return { master: { response }};
            }

            return { master: { response: response + `📋 *Analysis failed to parse.*\n\nTry being more specific, e.g.: "/do the Label Data dropdown in rei-dashboard doesn't show options"\n\n_Debug: ${e.message}_` }};
          }

          // ========== PHASE 3: PRESENT FINDINGS ==========
          response += `*🔎 Diagnosis:* ${analysis.diagnosis}\n\n`;
          response += `*🎯 Root Cause:* ${analysis.rootCause}\n\n`;

          if (analysis.fixes && analysis.fixes.length > 0) {
            response += `*🔧 Proposed Fixes:*\n`;
            for (let i = 0; i < analysis.fixes.length; i++) {
              const fix = analysis.fixes[i];
              // Large changes (>500 chars) are never safe
              const isLargeChange = fix.newCode && fix.newCode.length > 500;
              if (isLargeChange) fix.safe = false;

              const safeIcon = fix.safe ? '✅' : '⚠️';
              const sizeNote = isLargeChange ? ` (${fix.newCode.length} chars)` : '';
              response += `${safeIcon} ${i + 1}. *${fix.file}*: ${fix.description}${sizeNote}\n`;
              if (fix.oldCode && fix.newCode) {
                response += `   \`${fix.oldCode.substring(0, 40)}...\` → \`${fix.newCode.substring(0, 40)}...\`\n`;
              }
            }
          }

          if (analysis.manualSteps && analysis.manualSteps.length > 0) {
            response += `\n*👤 Manual Steps:*\n`;
            for (const ms of analysis.manualSteps) {
              response += `• ${ms}\n`;
            }
          }

          // ========== PHASE 4: AUTO-EXECUTE FIXES (FORCE MODE = ALL) ==========
          if (analysis.canAutoFix && analysis.fixes) {
            // In force mode, execute ALL fixes (safe + risky). Otherwise, only safe ones.
            const fixesToApply = forceMode
              ? analysis.fixes
              : analysis.fixes.filter(f => f.safe);

            if (fixesToApply.length > 0) {
              const modeLabel = forceMode ? '🚀 FORCE MODE' : '🔧 Safe';
              response += `\n\n${modeLabel} *Auto-executing ${fixesToApply.length} fix(es)...*\n`;

              for (const fix of fixesToApply) {
                try {
                  // Read current file
                  const currentFile = await github.readFile(targetOwner, targetRepo, fix.file);
                  let newContent = currentFile.content;

                  // Apply the fix
                  if (fix.oldCode && fix.newCode) {
                    newContent = newContent.replace(fix.oldCode, fix.newCode);
                  } else if (fix.newCode) {
                    newContent = fix.newCode;
                  }

                  // Commit the fix
                  await github.createOrUpdateFile(
                    targetOwner,
                    targetRepo,
                    fix.file,
                    newContent,
                    `Fix: ${fix.description}`,
                    currentFile.sha
                  );

                  response += `✅ Fixed: ${fix.file}${!fix.safe && forceMode ? ' ⚡' : ''}\n`;
                } catch (e) {
                  response += `❌ Failed ${fix.file}: ${e.message}\n`;
                }
              }

              response += `\n🎉 *Done! Changes committed to ${targetRepo}.*`;
              await context.updateContext('CURRENT WORK', `Fixed ${fixesToApply.length} issues in ${targetRepo}`);
            } else if (!forceMode) {
              response += `\n\n⚠️ *No safe auto-fixes available. Review needed.*`;

              // Store for manual confirmation - include owner/repo info
              const planToStore = {
                ...analysis,
                owner: targetOwner,
                repo: targetRepo
              };
              const storeResult = await memory.store(`plan_${usernameToId(userId)}`, JSON.stringify(planToStore), 'plans');
              const stateResult = await memory.store(`pending_${usernameToId(userId)}`, 'PLAN', 'state');
              console.log(`[Plan] Stored plan for ${usernameToId(userId)}: ${storeResult.success}, state: ${stateResult.success}`);
              response += `\n✅ *Reply "/do yes" to apply risky fixes, or use \`--force\` to skip confirmation*`;
            }
          } else if (!forceMode) {
            response += `\n\n⚠️ *Manual review required before applying fixes.*`;
            // Store for manual confirmation - include owner/repo info
            const planToStore = {
              ...analysis,
              owner: targetOwner,
              repo: targetRepo
            };
            const storeResult = await memory.store(`plan_${usernameToId(userId)}`, JSON.stringify(planToStore), 'plans');
            const stateResult = await memory.store(`pending_${usernameToId(userId)}`, 'PLAN', 'state');
            console.log(`[Plan] Stored plan for ${usernameToId(userId)}: ${storeResult.success}, state: ${stateResult.success}`);
            response += `\n✅ *Reply "/do yes" to proceed, or use \`--force\` to skip confirmation*`;
          }

          // Store context
          const planSummary = `Investigated ${targetRepo}: ${analysis.diagnosis}. Fixes: ${(analysis.fixes || []).map(f => f.description).join('; ')}`;
          await memory.store(`last_response_${userId}`, planSummary.substring(0, 1500), 'context');

          // ========== PHASE 5: SELF-REFLECTION (Record Outcome for Learning) ==========
          try {
            const fixesApplied = analysis.fixes?.filter(f => f.safe || forceMode).length || 0;
            const outcome = fixesApplied > 0 ? 'success' : (analysis.fixes?.length > 0 ? 'partial' : 'failure');

            await reflection.recordTaskOutcome({
              taskId: `exec_${Date.now()}`,
              taskType: taskTypeForReflection,
              context: task,
              action: planSummary.substring(0, 500),
              outcome,
              errorMessage: outcome === 'failure' ? 'No fixes could be applied' : null,
              tags: [targetRepo, taskTypeForReflection]
            });
            console.log(`[Reflection] Recorded ${outcome} outcome for ${taskTypeForReflection}`);
          } catch (e) {
            console.log('[Reflection] Failed to record outcome:', e.message);
          }

          // Ensure response isn't too long for Slack (keep confirmation visible)
          const maxLen = 2500;
          if (response.length > maxLen) {
            // Truncate middle, keep start and end (confirmation prompt)
            const lastPart = response.slice(-400); // Keep confirmation prompt
            response = response.substring(0, maxLen - 450) + '\n\n_... (truncated for Slack) ..._\n\n' + lastPart;
          }

          return { master: { response }};
        } catch (e) {
          return { master: { response: `❌ Failed to create plan: ${e.message}` }};
        }

      case 'CONFIRM_PLAN':
        // User confirmed they want to execute a previously generated plan
        try {
          // Retrieve the stored plan
          const storedPlan = await memory.retrieve(`plan_${userId}`);

          if (!storedPlan.value) {
            return { master: { response: `❌ No pending plan found. Please describe what you want to do first, and I'll create a plan for you to confirm.` }};
          }

          let planToExecute;
          try {
            planToExecute = JSON.parse(storedPlan.value);
          } catch (e) {
            return { master: { response: `❌ Could not parse stored plan. Please create a new plan.` }};
          }

          // Execute the automated steps
          let executionLog = `🚀 *Executing Plan...*\n\n`;
          let stepsExecuted = 0;
          let stepsFailed = 0;

          for (const step of planToExecute.plan || []) {
            if (!step.automated) {
              executionLog += `⏭️ *Step ${step.step}:* ${step.action} _(manual - skipped)_\n`;
              continue;
            }

            executionLog += `🔄 *Step ${step.step}:* ${step.action}...\n`;

            try {
              // Execute based on the API mentioned in the step
              if (step.api === 'github.getContent' || step.action.toLowerCase().includes('read')) {
                // Read operation - just log it
                const path = step.parameters?.path || '';
                const repo = step.parameters?.repo || 'rei-dashboard';
                const owner = step.parameters?.owner || 'sabriotcore-code';

                if (path) {
                  const content = await github.readFile(owner, repo, path);
                  executionLog += `  ✅ Read ${path} (${content.size || 0} bytes)\n`;
                } else {
                  const files = await github.listFiles(owner, repo, '');
                  executionLog += `  ✅ Listed ${files.length} files\n`;
                }
                stepsExecuted++;
              } else if (step.api === 'github.createOrUpdateFile' || step.action.toLowerCase().includes('commit') || step.action.toLowerCase().includes('push') || step.action.toLowerCase().includes('update')) {
                // This is a write operation - we need specific content
                executionLog += `  ⚠️ Write operation requires specific content - marked for review\n`;
              } else {
                executionLog += `  ℹ️ Step noted\n`;
                stepsExecuted++;
              }
            } catch (stepError) {
              executionLog += `  ❌ Failed: ${stepError.message}\n`;
              stepsFailed++;
            }
          }

          executionLog += `\n*Summary:* ${stepsExecuted} steps executed, ${stepsFailed} failed\n`;

          if (planToExecute.manualSteps && planToExecute.manualSteps.length > 0) {
            executionLog += `\n*Manual Steps Still Needed:*\n`;
            for (const ms of planToExecute.manualSteps) {
              executionLog += `👤 ${ms}\n`;
            }
          }

          // Clear the stored plan
          await memory.store(`plan_${userId}`, '', 'plans');

          await context.updateContext('CURRENT WORK', `Executed plan with ${stepsExecuted} steps`);

          return { master: { response: executionLog }};
        } catch (e) {
          // =========================================================================
          // CAUSAL INFERENCE (Item 9) - Analyze root cause of failure
          // =========================================================================
          let rootCauseAnalysis = '';
          try {
            const causeResult = await causal.analyzeRootCause(e.message, {
              action: 'execute_plan',
              task: query.substring(0, 200)
            });
            if (causeResult && causeResult.rootCause) {
              rootCauseAnalysis = `\n\n🔍 *Root Cause Analysis:*\n${causeResult.rootCause}\n` +
                (causeResult.suggestedFix ? `\n💡 *Suggested Fix:* ${causeResult.suggestedFix}` : '');
            }
          } catch (causeErr) {
            console.log('[Causal] Root cause analysis failed:', causeErr.message);
          }
          return { master: { response: `❌ Failed to execute plan: ${e.message}${rootCauseAnalysis}` }};
        }

      case 'ASK_AI':
        // ALWAYS include conversation context so AI knows what we're discussing
        const questionLower = (intent.params.question || '').toLowerCase();

        // Build rich context for the AI
        let contextForAI = '';

        // Include last response (the plan that was just shown, etc.)
        if (lastBotResponse) {
          contextForAI += `=== MY PREVIOUS RESPONSE ===\n${lastBotResponse}\n\n`;
        }

        // Include conversation history
        if (conversationContext) {
          contextForAI += `=== RECENT CONVERSATION ===\n${conversationContext}\n\n`;
        }

        // Include master context
        const aiMasterContext = await context.getContextSummary();
        if (aiMasterContext) {
          contextForAI += `=== PROJECT KNOWLEDGE ===\n${aiMasterContext}\n\n`;
        }

        // Include RAG context (semantic knowledge retrieval)
        if (ragContext) {
          contextForAI += `=== RELEVANT KNOWLEDGE (RAG) ===\n${ragContext}\n\n`;
        }

        // Include Mem0 long-term memory
        if (mem0Context) {
          contextForAI += `=== LONG-TERM MEMORY ===\n${mem0Context}\n\n`;
        }

        // For project/repo questions, also include real GitHub data
        if (questionLower.includes('project') || questionLower.includes('repo') ||
            questionLower.includes('what do') || questionLower.includes('what are')) {
          try {
            const repos = await github.listRepos(10);
            const repoInfo = repos.map(r => `- ${r.name}: ${r.description || 'No description'}`).join('\n');
            contextForAI += `=== GITHUB REPOS ===\n${repoInfo}\n\n`;
          } catch (e) {
            console.log('[ASK_AI] Could not get repo data:', e.message);
          }
        }

        // Build the enriched question with full context
        const enrichedQuestion = contextForAI
          ? `${contextForAI}=== USER'S QUESTION ===\n${intent.params.question}\n\nIMPORTANT: Use the context above to answer. You have full access to our conversation history and project knowledge.`
          : intent.params.question;

        // =========================================================================
        // INTELLIGENT REASONING (Chain-of-Thought / Ensemble / Specialist)
        // =========================================================================
        const complexity = reasoning.assessComplexity(enrichedQuestion);
        console.log(`[ASK_AI] Complexity: ${complexity.level} (score: ${complexity.score}), approach: ${complexity.recommendedApproach}`);

        let finalResponse, responseSource;

        if (complexity.level === 'high') {
          // High complexity: Use full reasoning orchestra (chain-of-thought or debate)
          console.log('[ASK_AI] Using advanced reasoning for complex query');
          const reasoningResult = await reasoning.reason(enrichedQuestion, { verbose: false });
          finalResponse = reasoningResult.finalAnswer || reasoningResult.answer;
          responseSource = `${reasoningResult.approach} (${reasoningResult.models?.join(', ') || 'multi-model'})`;
        } else if (complexity.level === 'medium') {
          // Medium complexity: Use specialist routing
          const specialistResult = await reasoning.specialistQuery(enrichedQuestion);
          finalResponse = specialistResult.answer;
          responseSource = `${specialistResult.model} specialist`;
        } else {
          // Low complexity: Use standard consensus
          const askResults = await ai.askAll(enrichedQuestion, 'general');
          const consensus = await ai.buildConsensus(askResults, 'weighted');
          finalResponse = consensus.response;
          responseSource = consensus.sources?.join(', ') || consensus.winner;
        }

        // Store this response for future context
        const aiResponse = (finalResponse || '').substring(0, 500);
        await memory.store(`last_response_${userId}`, aiResponse, 'context');

        // =========================================================================
        // REINFORCEMENT LEARNING (Item 8) - Track response for learning
        // =========================================================================
        const responseId = `resp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        try {
          await reinforcement.recordResponse({
            responseId,
            userId,
            queryType: complexity.factors.hasCode ? 'code' : complexity.factors.hasAnalysis ? 'analysis' : 'general',
            modelUsed: responseSource.split(' ')[0],
            approachUsed: complexity.recommendedApproach,
            responseLength: (finalResponse || '').length
          });

          // Record action for anticipation engine (Item 10)
          await anticipation.recordAction(userId, `ask_${complexity.level}`, enrichedQuestion.substring(0, 200));
        } catch (e) {
          console.log('[RL/Anticipation] Failed to record:', e.message);
        }

        // =========================================================================
        // ANTICIPATION (Item 10) - Predict next likely action
        // =========================================================================
        let suggestionText = '';
        try {
          const nextPrediction = await anticipation.predictNextAction(userId, `ask_${complexity.level}`);
          if (nextPrediction && nextPrediction.confidence > 0.6) {
            suggestionText = `\n\n💡 _Suggestion: ${nextPrediction.predictedAction}_`;
          }
        } catch (e) {
          // Ignore anticipation errors
        }

        return { master: {
          response: `🤖 *AI Response:*\n${finalResponse}\n\n` +
            `_Source: ${responseSource} | Complexity: ${complexity.level}_${suggestionText}`
        }};

      case 'REVIEW':
        const reviewResults = await ai.askAll(intent.params.code || query, 'review');
        return reviewResults;

      case 'CHALLENGE':
        const challengeResults = await ai.askAll(intent.params.content || query, 'challenge');
        return challengeResults;

      default:
        // Fallback: Ask all AIs
        const defaultResults = await ai.askAll(query, 'general');
        const defaultConsensus = await ai.buildConsensus(defaultResults, 'weighted');
        return { master: { response: defaultConsensus.response }};
    }
  } catch (error) {
    return { master: { response: `❌ Error: ${error.message}` }};
  }
}

// ============================================================================
// INTELLIGENCE SYSTEMS - Self-improving AI capabilities
// ============================================================================

// --- Reflection & Error Learning ---

app.post('/intelligence/reflection/record', async (req, res) => {
  try {
    const result = await reflection.recordTaskOutcome(req.body);
    res.json({ success: true, reflection: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/reflection/predict/:taskType', async (req, res) => {
  try {
    const predictions = await reflection.predictErrors(req.params.taskType, req.query.context);
    res.json({ predictions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/reflection/lessons/:taskType', async (req, res) => {
  try {
    const lessons = await reflection.getApplicableLessons(req.params.taskType, req.query.context);
    res.json({ lessons });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/reflection/stats', async (req, res) => {
  try {
    const stats = await reflection.getReflectionStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/reflection/suggestions', async (req, res) => {
  try {
    const suggestions = await reflection.getImprovementSuggestions();
    res.json({ suggestions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Context Memory ---

app.post('/intelligence/memory/working', async (req, res) => {
  try {
    const { sessionId, contextType, content, relevance } = req.body;
    const result = await contextMemory.addToWorkingMemory(sessionId, contextType, content, relevance);
    res.json({ success: true, memory: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/memory/working/:sessionId', async (req, res) => {
  try {
    const memories = await contextMemory.getWorkingMemory(req.params.sessionId);
    res.json({ memories });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/memory/short-term', async (req, res) => {
  try {
    const { userId, memoryType, content, context, importance } = req.body;
    const result = await contextMemory.storeShortTerm(userId, memoryType, content, context, importance);
    res.json({ success: true, memory: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/memory/long-term', async (req, res) => {
  try {
    const { userId, category, key, value, source } = req.body;
    const result = await contextMemory.storeLongTerm(userId, category, key, value, source);
    res.json({ success: true, memory: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/memory/context/:userId', async (req, res) => {
  try {
    const contextStr = await contextMemory.buildContextString(
      req.params.userId,
      req.query.sessionId,
      req.query.query
    );
    res.json({ context: contextStr });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/memory/stats/:userId', async (req, res) => {
  try {
    const stats = await contextMemory.getMemoryStats(req.params.userId);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/memory/consolidate/:userId', async (req, res) => {
  try {
    const count = await contextMemory.consolidateMemories(req.params.userId);
    res.json({ success: true, consolidated: count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Multi-Model Reasoning Orchestra ---

app.post('/intelligence/reason', async (req, res) => {
  try {
    const { query, options } = req.body;
    const result = await reasoning.reason(query, options || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/reason/chain', async (req, res) => {
  try {
    const { query, options } = req.body;
    const result = await reasoning.chainOfThought(query, options || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/reason/debate', async (req, res) => {
  try {
    const { query, options } = req.body;
    const result = await reasoning.debateLoop(query, options || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/reason/ensemble', async (req, res) => {
  try {
    const { query, options } = req.body;
    const result = await reasoning.ensembleQuery(query, options || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/reason/assess', async (req, res) => {
  try {
    const { query } = req.body;
    const complexity = reasoning.assessComplexity(query);
    const taskTypes = reasoning.classifyTaskType(query);
    const models = reasoning.selectModels(taskTypes, complexity);
    res.json({ complexity, taskTypes, recommendedModels: models });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Proactive Anticipation ---

app.post('/intelligence/anticipation/record', async (req, res) => {
  try {
    const { userId, action, context } = req.body;
    const result = await anticipation.recordAction(userId, action, context);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/anticipation/predict/:userId', async (req, res) => {
  try {
    const predictions = await anticipation.predictNextAction(
      req.params.userId,
      req.query.currentAction,
      req.query.context ? JSON.parse(req.query.context) : null
    );
    res.json({ predictions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/anticipation/suggestions/:userId', async (req, res) => {
  try {
    const context = req.query.context ? JSON.parse(req.query.context) : {};
    const suggestions = await anticipation.generateSuggestions(req.params.userId, context);
    res.json({ suggestions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/anticipation/workflows/:userId', async (req, res) => {
  try {
    const workflows = await anticipation.analyzeWorkflows(req.params.userId);
    res.json({ workflows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/anticipation/stats/:userId', async (req, res) => {
  try {
    const stats = await anticipation.getAnticipationStats(req.params.userId);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Reinforcement Learning ---

app.post('/intelligence/reinforcement/response', async (req, res) => {
  try {
    const result = await reinforcement.recordResponse(req.body);
    res.json({ success: true, feedback: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/reinforcement/rating', async (req, res) => {
  try {
    const { responseId, rating } = req.body;
    await reinforcement.recordExplicitRating(responseId, rating);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/reinforcement/signal', async (req, res) => {
  try {
    const { responseId, signal } = req.body;
    await reinforcement.recordImplicitSignal(responseId, signal);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/reinforcement/select-strategy', async (req, res) => {
  try {
    const { contextType, strategies, epsilon } = req.body;
    const result = await reinforcement.selectStrategy(contextType, strategies, epsilon);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/reinforcement/strategies', async (req, res) => {
  try {
    const report = await reinforcement.getStrategyReport();
    res.json({ strategies: report });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/reinforcement/experiment', async (req, res) => {
  try {
    const { name, variantA, variantB } = req.body;
    const experiment = await reinforcement.createExperiment(name, variantA, variantB);
    res.json({ success: true, experiment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/reinforcement/experiment/:name', async (req, res) => {
  try {
    const variant = await reinforcement.getExperimentVariant(req.params.name);
    res.json(variant || { error: 'Experiment not found or concluded' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/reinforcement/improvement', async (req, res) => {
  try {
    const score = await reinforcement.getImprovementScore();
    res.json(score);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/reinforcement/stats', async (req, res) => {
  try {
    const stats = await reinforcement.getReinforcementStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Combined Intelligence Status ---

app.get('/intelligence/status', async (req, res) => {
  try {
    const [reflectionStats, improvementScore] = await Promise.all([
      reflection.getReflectionStats().catch(() => ({ error: 'unavailable' })),
      reinforcement.getImprovementScore().catch(() => ({ error: 'unavailable' }))
    ]);

    res.json({
      status: 'active',
      systems: {
        reflection: reflectionStats,
        contextMemory: 'ready',
        reasoning: 'ready',
        anticipation: 'ready',
        reinforcement: improvementScore,
        enhancedRag: 'ready',
        multimodal: 'ready',
        codegen: 'ready',
        sentiment: 'ready',
        anomaly: 'ready',
        causal: 'ready',
        planner: 'ready',
        automl: 'ready',
        monitoring: 'ready',
        nlpInterface: 'ready'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// ENHANCED RAG ENDPOINTS
// ============================================================================

app.post('/intelligence/rag/query', async (req, res) => {
  try {
    const { query, options } = req.body;
    const result = await enhancedRag.ragQuery(query, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/rag/decompose', async (req, res) => {
  try {
    const { query } = req.body;
    const result = await enhancedRag.decomposeQuery(query);
    res.json({ query, subQueries: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// MULTIMODAL + PREDICTIVE ANALYTICS ENDPOINTS
// ============================================================================

app.post('/intelligence/vision/analyze', async (req, res) => {
  try {
    const { imageUrl, prompt } = req.body;
    const result = await multimodal.analyzeImage(imageUrl, prompt);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/vision/ocr', async (req, res) => {
  try {
    const { imageUrl } = req.body;
    const result = await multimodal.extractText(imageUrl);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/forecast', async (req, res) => {
  try {
    const { data, options } = req.body;
    const result = await multimodal.forecast(data, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/predict/capacity', async (req, res) => {
  try {
    const { data, options } = req.body;
    const result = await multimodal.predictCapacity(data, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// CODE GENERATION ENDPOINTS
// ============================================================================

app.post('/intelligence/codegen/generate', async (req, res) => {
  try {
    const { description, options } = req.body;
    const result = await codegen.generateCode(description, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/codegen/review', async (req, res) => {
  try {
    const { code, options } = req.body;
    const result = await codegen.reviewCode(code, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/codegen/fix', async (req, res) => {
  try {
    const { code, errorMessage } = req.body;
    const result = await codegen.fixCode(code, errorMessage);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/codegen/tests', async (req, res) => {
  try {
    const { code, options } = req.body;
    const result = await codegen.generateTests(code, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/codegen/execute', async (req, res) => {
  try {
    const { description, options } = req.body;
    const result = await codegen.selfHealingExecute(description, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// SENTIMENT ANALYSIS ENDPOINTS
// ============================================================================

app.post('/intelligence/sentiment/analyze', async (req, res) => {
  try {
    const { text } = req.body;
    const result = await sentimentAnalysis.analyzeSentiment(text);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/sentiment/emotions', async (req, res) => {
  try {
    const { text } = req.body;
    const result = await sentimentAnalysis.detectEmotions(text);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/sentiment/track', async (req, res) => {
  try {
    const { userId, text, context } = req.body;
    const result = await sentimentAnalysis.trackMood(userId, text, context);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/sentiment/trend/:userId', async (req, res) => {
  try {
    const { hours } = req.query;
    const result = await sentimentAnalysis.getMoodTrend(req.params.userId, parseInt(hours) || 24);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/sentiment/style/:userId', async (req, res) => {
  try {
    const result = await sentimentAnalysis.getResponseStyle(req.params.userId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// ANOMALY DETECTION ENDPOINTS
// ============================================================================

app.post('/intelligence/anomaly/detect', async (req, res) => {
  try {
    const { data, options } = req.body;
    const result = anomaly.detectAll(data, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/anomaly/zscore', async (req, res) => {
  try {
    const { data, threshold } = req.body;
    const result = anomaly.detectZScore(data, threshold);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/anomaly/sudden-change', async (req, res) => {
  try {
    const { data, windowSize, threshold } = req.body;
    const result = anomaly.detectSuddenChanges(data, windowSize, threshold);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/anomaly/alerts', async (req, res) => {
  try {
    const { severity } = req.query;
    const result = await anomaly.getActiveAlerts(severity);
    res.json({ alerts: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// PROACTIVE MONITORING ENDPOINT (Item 6)
// ============================================================================

app.post('/intelligence/monitor/check', async (req, res) => {
  try {
    const { alertChannel, thresholds = {} } = req.body;
    const alerts = [];

    // 1. Get system health
    const health = monitoring.getHealthSummary();

    // 2. Check for critical conditions
    const memoryUsed = parseFloat(health.memory);
    if (memoryUsed > (thresholds.memoryPercent || 85)) {
      alerts.push({ type: 'memory', severity: 'critical', message: `High memory usage: ${health.memory}` });
    }

    const errorRate = parseFloat(health.errorRate);
    if (errorRate > (thresholds.errorRatePercent || 5)) {
      alerts.push({ type: 'errors', severity: 'critical', message: `High error rate: ${health.errorRate}` });
    }

    // 3. Get recent errors for alerting
    const recentErrors = monitoring.getRecentErrors(10);
    const criticalErrors = recentErrors.filter(e =>
      e.message.includes('FATAL') || e.message.includes('CRITICAL') || e.name === 'FatalError'
    );
    if (criticalErrors.length > 0) {
      alerts.push({
        type: 'critical_error',
        severity: 'critical',
        message: `${criticalErrors.length} critical error(s): ${criticalErrors[0].message.substring(0, 100)}`
      });
    }

    // 4. Check for unacknowledged anomaly alerts
    const anomalyAlerts = await anomaly.getActiveAlerts('critical');
    if (anomalyAlerts.length > 0) {
      alerts.push({
        type: 'anomaly',
        severity: 'warning',
        message: `${anomalyAlerts.length} unacknowledged anomaly alert(s)`
      });
    }

    // 5. Send to Slack if configured and there are alerts
    let slackSent = false;
    if (alertChannel && alerts.length > 0 && slackApp) {
      try {
        const alertText = alerts.map(a =>
          `${a.severity === 'critical' ? '🔴' : '⚠️'} *${a.type.toUpperCase()}*: ${a.message}`
        ).join('\n');

        await slackApp.client.chat.postMessage({
          channel: alertChannel,
          text: `🚨 *Proactive Monitoring Alert*\n\n${alertText}\n\n_Health: ${health.status} | Uptime: ${health.uptime}_`
        });
        slackSent = true;
      } catch (slackErr) {
        console.error('[Monitor] Slack alert failed:', slackErr.message);
      }
    }

    res.json({
      health,
      alerts,
      alertCount: alerts.length,
      slackSent,
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// PROPERTY/RENT ANOMALY DETECTION (Item 7)
// ============================================================================

app.post('/intelligence/anomaly/property-data', async (req, res) => {
  try {
    const { rentValues, occupancyRates, paymentHistory, alertChannel } = req.body;
    const results = {};

    // Analyze rent values for anomalies
    if (rentValues && rentValues.length > 0) {
      results.rent = anomaly.detectAll(rentValues, { methods: ['zscore', 'iqr', 'sudden-change'] });
    }

    // Analyze occupancy rates
    if (occupancyRates && occupancyRates.length > 0) {
      results.occupancy = anomaly.detectAll(occupancyRates, { methods: ['zscore', 'trend-break'] });
    }

    // Analyze payment patterns
    if (paymentHistory && paymentHistory.length > 0) {
      results.payments = anomaly.detectSuddenChanges(paymentHistory, 5, 2);
    }

    // Count critical anomalies
    const criticalCount = [
      results.rent?.confirmedAnomalies?.filter(a => a.severity === 'critical').length || 0,
      results.occupancy?.confirmedAnomalies?.filter(a => a.severity === 'critical').length || 0,
      results.payments?.anomalies?.filter(a => a.severity === 'critical').length || 0
    ].reduce((a, b) => a + b, 0);

    // Alert to Slack if critical anomalies found
    if (alertChannel && criticalCount > 0 && slackApp) {
      try {
        let alertText = `🏠 *Property Data Anomalies Detected*\n\n`;
        if (results.rent?.confirmedAnomalies?.length > 0) {
          alertText += `📊 *Rent:* ${results.rent.confirmedAnomalies.length} anomalies\n`;
        }
        if (results.occupancy?.confirmedAnomalies?.length > 0) {
          alertText += `🏢 *Occupancy:* ${results.occupancy.confirmedAnomalies.length} anomalies\n`;
        }
        if (results.payments?.anomalies?.length > 0) {
          alertText += `💰 *Payments:* ${results.payments.anomalies.length} anomalies\n`;
        }

        await slackApp.client.chat.postMessage({
          channel: alertChannel,
          text: alertText
        });
      } catch (slackErr) {
        console.error('[Anomaly] Slack alert failed:', slackErr.message);
      }
    }

    res.json({
      results,
      summary: {
        criticalAnomalies: criticalCount,
        rentAnomalies: results.rent?.confirmedAnomalies?.length || 0,
        occupancyAnomalies: results.occupancy?.confirmedAnomalies?.length || 0,
        paymentAnomalies: results.payments?.anomalies?.length || 0
      },
      analyzedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Background monitoring (runs every 5 minutes if MONITOR_INTERVAL is set)
if (process.env.MONITOR_INTERVAL && process.env.SLACK_ALERT_CHANNEL) {
  const interval = parseInt(process.env.MONITOR_INTERVAL) || 300000; // 5 min default
  setInterval(async () => {
    try {
      const health = monitoring.getHealthSummary();
      if (health.status === 'degraded' && slackApp) {
        await slackApp.client.chat.postMessage({
          channel: process.env.SLACK_ALERT_CHANNEL,
          text: `🚨 *System Degraded*\n\nMemory: ${health.memory}\nError Rate: ${health.errorRate}\nUptime: ${health.uptime}`
        });
      }
    } catch (e) {
      console.error('[Monitor] Background check failed:', e.message);
    }
  }, interval);
  console.log(`[Monitor] Background monitoring enabled (${interval / 1000}s interval)`);
}

// ============================================================================
// CAUSAL REASONING ENDPOINTS
// ============================================================================

app.post('/intelligence/causal/graph', async (req, res) => {
  try {
    const { events, options } = req.body;
    const result = await causal.buildCausalGraph(events, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/causal/root-cause', async (req, res) => {
  try {
    const { effect, events, options } = req.body;
    const result = await causal.findRootCauses(effect, events, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/causal/analyze', async (req, res) => {
  try {
    const { symptom, context } = req.body;
    const result = await causal.analyzeRootCause(symptom, context);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/causal/impact', async (req, res) => {
  try {
    const { cause, events, options } = req.body;
    const result = await causal.predictImpact(cause, events, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// HIERARCHICAL TASK PLANNER ENDPOINTS
// ============================================================================

app.post('/intelligence/planner/decompose', async (req, res) => {
  try {
    const { goal, options } = req.body;
    const result = await planner.decomposeGoal(goal, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/planner/plan', async (req, res) => {
  try {
    const { goal, options } = req.body;
    const result = await planner.createExecutionPlan(goal, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/planner/save', async (req, res) => {
  try {
    const { plan } = req.body;
    const result = await planner.savePlan(plan);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/planner/progress', async (req, res) => {
  try {
    const { planId, taskId, status, notes } = req.body;
    const result = await planner.updateProgress(planId, taskId, status, notes);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/planner/status/:planId', async (req, res) => {
  try {
    const result = await planner.getPlanStatus(req.params.planId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/planner/active', async (req, res) => {
  try {
    const result = await planner.listActivePlans();
    res.json({ plans: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// AUTOML OPTIMIZER ENDPOINTS
// ============================================================================

app.post('/intelligence/automl/benchmark', async (req, res) => {
  try {
    const { prompt, options } = req.body;
    const result = await automl.benchmarkModels(prompt, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/automl/optimize-prompt', async (req, res) => {
  try {
    const { prompt, options } = req.body;
    const result = await automl.optimizePrompt(prompt, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/automl/fallback', async (req, res) => {
  try {
    const { prompt, options } = req.body;
    const result = await automl.executeWithFallback(prompt, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/automl/experiment', async (req, res) => {
  try {
    const { name, variants } = req.body;
    const result = await automl.createExperiment(name, variants);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/automl/experiment/:experimentId', async (req, res) => {
  try {
    const result = await automl.getExperimentResults(req.params.experimentId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/automl/cost-optimize', async (req, res) => {
  try {
    const { taskType, options } = req.body;
    const result = await automl.optimizeCostPerformance(taskType, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// SYSTEM MONITORING ENDPOINTS
// ============================================================================

app.get('/intelligence/monitoring/health', async (req, res) => {
  try {
    const result = monitoring.getHealthSummary();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/monitoring/metrics', async (req, res) => {
  try {
    const result = monitoring.getAllMetrics();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/monitoring/errors', async (req, res) => {
  try {
    const { limit } = req.query;
    const result = monitoring.getRecentErrors(parseInt(limit) || 20);
    res.json({ errors: result, stats: monitoring.getErrorStats() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/monitoring/sla', async (req, res) => {
  try {
    const { threshold } = req.query;
    const result = monitoring.getSLAReport({ latencyThreshold: parseInt(threshold) || 1000 });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/monitoring/resources', async (req, res) => {
  try {
    const result = monitoring.getResourceUsage();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/monitoring/traces', async (req, res) => {
  try {
    const { limit } = req.query;
    const result = await monitoring.getTraceHistory(parseInt(limit) || 50);
    res.json({ traces: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// NLP INTERFACE ENDPOINTS
// ============================================================================

app.post('/intelligence/nlp/parse', async (req, res) => {
  try {
    const { text, userId } = req.body;
    const result = await nlpInterface.parseCommand(text, userId || 'default');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/nlp/intent', async (req, res) => {
  try {
    const { text, options } = req.body;
    const result = await nlpInterface.classifyIntent(text, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/nlp/entities', async (req, res) => {
  try {
    const { text, entityTypes } = req.body;
    const result = await nlpInterface.extractEntitiesAI(text, entityTypes);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/nlp/dialog/start', async (req, res) => {
  try {
    const { userId, template, initialSlots } = req.body;
    const result = nlpInterface.startDialog(userId, template, initialSlots);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/nlp/dialog/continue', async (req, res) => {
  try {
    const { dialogId, input } = req.body;
    const result = nlpInterface.continueDialog(dialogId, input);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/intelligence/nlp/dialog/complete', async (req, res) => {
  try {
    const { dialogId } = req.body;
    const result = nlpInterface.completeDialog(dialogId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/intelligence/nlp/context/:userId', async (req, res) => {
  try {
    const result = nlpInterface.getUserContext(req.params.userId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// #8: GITHUB WEBHOOKS - Real-time event notifications
// ============================================================================

app.post('/webhooks/github', express.json(), async (req, res) => {
  const event = req.headers['x-github-event'];
  const payload = req.body;

  console.log(`[Webhook] GitHub event: ${event}`);

  try {
    let notification = null;

    switch (event) {
      case 'push':
        const commits = payload.commits?.length || 0;
        const branch = payload.ref?.replace('refs/heads/', '') || 'unknown';
        notification = `🔔 *Push to ${payload.repository?.name}*\n` +
          `Branch: ${branch}\n` +
          `Commits: ${commits}\n` +
          `By: ${payload.pusher?.name || 'unknown'}`;
        break;

      case 'pull_request':
        notification = `🔔 *PR ${payload.action}: ${payload.pull_request?.title}*\n` +
          `Repo: ${payload.repository?.name}\n` +
          `By: ${payload.pull_request?.user?.login}`;
        break;

      case 'issues':
        notification = `🔔 *Issue ${payload.action}: ${payload.issue?.title}*\n` +
          `Repo: ${payload.repository?.name}\n` +
          `By: ${payload.issue?.user?.login}`;
        break;

      case 'workflow_run':
        const status = payload.workflow_run?.conclusion || payload.workflow_run?.status;
        notification = `🔔 *Workflow ${status}: ${payload.workflow_run?.name}*\n` +
          `Repo: ${payload.repository?.name}`;
        break;
    }

    if (notification) {
      // Store notification for retrieval
      await memory.store(`webhook_${Date.now()}`, notification, 'webhooks');

      // TODO: Send to Slack channel if configured
      console.log('[Webhook] Notification:', notification);
    }

    res.status(200).json({ received: true, event });
  } catch (error) {
    console.error('[Webhook] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get recent webhook notifications
app.get('/webhooks/recent', async (req, res) => {
  try {
    const webhooks = await memory.retrieveCategory('webhooks');
    res.json({ notifications: webhooks.values || {} });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// #9: BUILD/DEPLOY STATUS - Monitor Railway/Netlify
// ============================================================================

app.get('/deploy/status', async (req, res) => {
  try {
    const status = {
      railway: {
        url: 'https://web-production-bdfb4.up.railway.app',
        uptime: process.uptime(),
        healthy: true
      },
      netlify: {
        url: 'https://rei-dashboard-15rrr.netlify.app',
        status: 'unknown' // Would need Netlify API key to check
      }
    };

    // Check if Railway is responding
    try {
      const selfCheck = await fetch(`${status.railway.url}/health`);
      status.railway.healthy = selfCheck.ok;
    } catch (e) {
      status.railway.healthy = false;
    }

    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// #10: SCHEDULED TASKS - Cron-like functionality
// ============================================================================

const scheduledTasks = new Map();

// Register a scheduled task
app.post('/tasks/schedule', async (req, res) => {
  const { name, action, interval, params } = req.body;

  if (!name || !action || !interval) {
    return res.status(400).json({ error: 'name, action, and interval are required' });
  }

  // Clear existing task with same name
  if (scheduledTasks.has(name)) {
    clearInterval(scheduledTasks.get(name).timer);
  }

  // Parse interval (e.g., "5m", "1h", "24h")
  const match = interval.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    return res.status(400).json({ error: 'interval must be like "5m", "1h", "24h"' });
  }

  const [, num, unit] = match;
  const ms = parseInt(num) * (unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 86400000);

  // Create the scheduled task
  const timer = setInterval(async () => {
    console.log(`[Scheduled] Running: ${name}`);
    try {
      await handleMasterCommand(action, 'scheduler');
    } catch (e) {
      console.error(`[Scheduled] Error in ${name}:`, e.message);
    }
  }, ms);

  scheduledTasks.set(name, { action, interval, params, timer, createdAt: new Date() });

  // Also store in DB for persistence
  await memory.store(`schedule_${name}`, JSON.stringify({ action, interval, params }), 'schedules');

  res.json({ success: true, name, interval, nextRun: new Date(Date.now() + ms) });
});

// List scheduled tasks
app.get('/tasks/schedule', async (req, res) => {
  const tasks = [];
  for (const [name, task] of scheduledTasks) {
    tasks.push({
      name,
      action: task.action,
      interval: task.interval,
      createdAt: task.createdAt
    });
  }
  res.json({ tasks });
});

// Delete a scheduled task
app.delete('/tasks/schedule/:name', async (req, res) => {
  const { name } = req.params;

  if (scheduledTasks.has(name)) {
    clearInterval(scheduledTasks.get(name).timer);
    scheduledTasks.delete(name);
    await memory.store(`schedule_${name}`, '', 'schedules');
    res.json({ success: true, deleted: name });
  } else {
    res.status(404).json({ error: 'Task not found' });
  }
});

// ============================================================================
// Register new service endpoints
registerNewServiceEndpoints(app, neo4j, e2b, firecrawl, mem0);

// SLACK INTEGRATION
// ============================================================================

// Initialize Slack if credentials are provided
// Pass handleMasterCommand for routing @mentions, DMs, reactions, and buttons
initSlack(app, handleMasterCommand);

// Slack events endpoint
app.post('/slack/events', async (req, res) => {
  if (!slackApp) {
    return res.status(503).json({ error: 'Slack not configured' });
  }

  try {
    // Parse body if raw
    const body = typeof req.body === 'string' ? JSON.parse(req.body) :
                 Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;

    // Handle Slack URL verification challenge
    if (body.type === 'url_verification') {
      return res.json({ challenge: body.challenge });
    }

    res.status(200).send();
  } catch (error) {
    console.error('[Slack] Event error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Slack slash commands endpoint
app.post('/slack/commands', express.urlencoded({ extended: true }), async (req, res) => {
  if (!slackApp) {
    return res.status(503).json({ error: 'Slack not configured' });
  }

  const { command, text, response_url, user_name } = req.body;
  console.log(`[Slack] Command: ${command} from ${user_name}`);

  // Acknowledge immediately
  res.status(200).json({ response_type: 'ephemeral', text: '🤔 Processing...' });

  try {
    let result;
    const content = text.trim();

    switch (command) {
      case '/ask':
      case '/review':
      case '/challenge':
        const mode = command === '/challenge' ? 'challenge' :
                     command === '/review' ? 'review' : 'general';
        result = await ai.askAll(content || 'Hello', mode);
        break;
      case '/consensus':
        const allResults = await ai.askAll(content || 'Hello', 'general');
        const consensus = await ai.buildConsensus(allResults, 'weighted');
        result = { consensus };
        break;
      case '/health':
        result = { health: {
          ...ai.getProviderStatus(),
          github: github.isConfigured(),
          web: web.isConfigured(),
          google: google.isConfigured()
        }};
        break;
      case '/repos':
        result = { repos: await github.listRepos(20) };
        break;
      case '/commits':
        if (!content.includes('/')) {
          result = { error: 'Usage: /commits owner/repo' };
        } else {
          const [owner, repo] = content.split('/');
          result = { commits: await github.getCommits(owner, repo, 10) };
        }
        break;
      case '/files':
        const filesMatch = content.match(/^([^\/]+)\/([^\s]+)(?:\s+(.*))?$/);
        if (!filesMatch) {
          result = { error: 'Usage: /files owner/repo [path]' };
        } else {
          const [, fOwner, fRepo, fPath = ''] = filesMatch;
          result = { files: await github.listFiles(fOwner, fRepo, fPath), path: fPath || 'root' };
        }
        break;
      case '/readfile':
        const readMatch = content.match(/^([^\/]+)\/([^\s]+)\s+(.+)$/);
        if (!readMatch) {
          result = { error: 'Usage: /readfile owner/repo path/to/file' };
        } else {
          const [, rOwner, rRepo, rPath] = readMatch;
          result = { file: await github.readFile(rOwner, rRepo, rPath) };
        }
        break;
      case '/issues':
        if (!content.includes('/')) {
          result = { error: 'Usage: /issues owner/repo' };
        } else {
          const [iOwner, iRepo] = content.split('/');
          result = { issues: await github.listIssues(iOwner, iRepo, 'open', 15) };
        }
        break;
      case '/codesearch':
        if (!content) {
          result = { error: 'Usage: /codesearch <query>' };
        } else {
          result = { search: await github.searchCode(content, 10), query: content };
        }
        break;
      case '/history':
        // Show recent changes made by the bot
        const historyMatch = content.match(/^([^\/]+)\/([^\s]+)/);
        if (!historyMatch) {
          result = { error: 'Usage: /history owner/repo' };
        } else {
          const [, hOwner, hRepo] = historyMatch;
          const changes = await github.getChangeHistory(hOwner, hRepo, 10);
          result = {
            history: github.formatChangeHistory(changes),
            repo: `${hOwner}/${hRepo}`,
            count: changes.length
          };
        }
        break;
      case '/rollback':
        // Rollback a file to previous version
        if (!content) {
          result = { error: 'Usage: /rollback owner/repo path/to/file [changeId]\nUse /history to see available changes' };
        } else {
          const parts = content.trim().split(/\s+/);
          const repoArg = parts[0];
          const fileArg = parts[1];
          const changeIdArg = parts[2];

          if (!repoArg || !repoArg.includes('/')) {
            result = { error: 'Usage: /rollback owner/repo path/to/file [changeId]' };
          } else {
            const [rOwner, rRepo] = repoArg.split('/');
            try {
              if (changeIdArg) {
                // Execute rollback
                await github.rollbackFile(rOwner, rRepo, fileArg, changeIdArg, user_name);
                result = { success: true, message: `Rolled back ${fileArg} successfully` };
              } else if (fileArg) {
                // Show available versions for this file
                const rollbackInfo = await github.getChangeHistory(rOwner, rRepo, 20);
                const fileChanges = rollbackInfo.filter(c => c.path === fileArg && c.oldContent);
                result = {
                  file: fileArg,
                  versions: fileChanges.slice(0, 5).map(c => `• \`${c.id}\` - ${c.message} (${new Date(c.timestamp).toLocaleString()})`).join('\n'),
                  usage: 'Use /rollback owner/repo file changeId to restore'
                };
              } else {
                // Show all recent changes
                const changes = await github.getChangeHistory(rOwner, rRepo, 10);
                result = {
                  changes: github.formatChangeHistory(changes),
                  usage: 'Use /rollback owner/repo file changeId to restore'
                };
              }
            } catch (e) {
              result = { error: e.message };
            }
          }
        }
        break;
      case '/do':
        // Master AI command - figures out what to do
        result = await handleMasterCommand(content, user_name);
        break;
      default:
        result = { error: 'Unknown command' };
    }

    // Send async response
    await fetch(response_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_type: 'in_channel',
        text: formatSlackResponse(command, result)
      }),
    });
  } catch (error) {
    console.error('[Slack] Command error:', error);
    await fetch(req.body.response_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `❌ Error: ${error.message}` }),
    });
  }
});

// Format Slack response with auto-truncation for long messages
function formatSlackResponse(command, result) {
  let response = formatSlackResponseInternal(command, result);

  // Truncate if too long for Slack (max 4000 chars, leave room for safety)
  if (response.length > 3800) {
    response = truncate(response, 3800, '\n\n_... (truncated for Slack)_');
  }

  return response;
}

function formatSlackResponseInternal(command, result) {
  if (result.error) return `❌ ${result.error}`;
  if (result.health) {
    const h = result.health;
    return `🏥 *System Status:*\n` +
      `*AI:* Claude ${h.claude ? '✅' : '❌'} | GPT ${h.gpt ? '✅' : '❌'} | Gemini ${h.gemini ? '✅' : '❌'}\n` +
      `*Services:* GitHub ${h.github ? '✅' : '❌'} | Web ${h.web ? '✅' : '❌'} | Google ${h.google ? '✅' : '❌'}`;
  }
  if (result.consensus) {
    return `🤝 *Consensus:*\n${result.consensus.response || 'No consensus'}`;
  }
  if (result.repos) {
    let text = `📂 *Your GitHub Repositories:*\n\n`;
    for (const repo of result.repos) {
      text += `• *${repo.name}* ${repo.isPrivate ? '🔒' : '🌐'}\n`;
    }
    return text;
  }
  if (result.commits) {
    let text = `📜 *Recent Commits:*\n\n`;
    for (const c of result.commits) {
      text += `• \`${c.sha}\` ${c.message}\n  _by ${c.author}_\n`;
    }
    return text;
  }
  if (result.files) {
    let text = `📁 *Files in ${result.path}:*\n\n`;
    for (const f of result.files) {
      const icon = f.type === 'dir' ? '📂' : '📄';
      text += `${icon} ${f.name}\n`;
    }
    return text;
  }
  if (result.file) {
    const preview = result.file.content.substring(0, 1500);
    const truncated = result.file.content.length > 1500 ? '\n_(truncated)_' : '';
    return `📖 *${result.file.path}* (${result.file.size} bytes)\n\`\`\`\n${preview}${truncated}\n\`\`\``;
  }
  if (result.issues) {
    if (result.issues.length === 0) return `🎫 *No open issues*`;
    let text = `🎫 *Open Issues:*\n\n`;
    for (const i of result.issues) {
      text += `• #${i.number} ${i.title}\n  _by ${i.author}_\n`;
    }
    return text;
  }
  if (result.search) {
    if (result.search.length === 0) return `🔍 *No results for "${result.query}"*`;
    let text = `🔍 *Search results for "${result.query}":*\n\n`;
    for (const r of result.search) {
      text += `• *${r.repo}* - ${r.path}\n`;
    }
    return text;
  }
  if (result.master) {
    return result.master.response;
  }

  let text = `*${command.slice(1).toUpperCase()} Results:*\n\n`;
  for (const [provider, r] of Object.entries(result)) {
    if (r.success) {
      text += `*${provider.toUpperCase()}* (${r.latencyMs}ms):\n${r.response.substring(0, 500)}\n\n`;
    }
  }
  return text;
}

// ============================================================================
// SERVICE INITIALIZATION
// ============================================================================

async function initializeServices() {
  console.log('[Startup] Initializing services...');

  // Initialize Neo4j Knowledge Graph
  try {
    neo4j.initNeo4j();
    console.log('[Startup] ✓ Neo4j initialized');
  } catch (e) {
    console.log('[Startup] ✗ Neo4j failed:', e.message);
  }

  // Initialize E2B Code Execution
  try {
    e2b.initE2B();
    console.log('[Startup] ✓ E2B initialized');
  } catch (e) {
    console.log('[Startup] ✗ E2B failed:', e.message);
  }

  // Initialize Firecrawl Web Scraping
  try {
    firecrawl.initFirecrawl();
    console.log('[Startup] ✓ Firecrawl initialized');
  } catch (e) {
    console.log('[Startup] ✗ Firecrawl failed:', e.message);
  }

  // Initialize Mem0 Long-term Memory
  try {
    mem0.initMem0();
    console.log('[Startup] ✓ Mem0 initialized');
  } catch (e) {
    console.log('[Startup] ✗ Mem0 failed:', e.message);
  }

  console.log('[Startup] Service initialization complete');
}

// ============================================================================
// NEO4J KEEP-ALIVE (prevents free tier from pausing)
// ============================================================================

async function neo4jKeepAlive() {
  const status = neo4j.getNeo4jStatus();
  if (!status.connected) {
    console.log('[KeepAlive] Neo4j not connected, attempting reconnect...');
    neo4j.initNeo4j();
    return;
  }

  try {
    // Simple query to keep the connection alive
    await neo4j.findEntities('Property', {}, 1);
    console.log(`[KeepAlive] Neo4j ping successful at ${new Date().toISOString()}`);
  } catch (e) {
    console.log('[KeepAlive] Neo4j ping failed:', e.message);
    // Try to reconnect
    neo4j.initNeo4j();
  }
}

// Run Neo4j keep-alive every 12 hours (twice daily keeps free tier active)
const NEO4J_KEEPALIVE_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours in ms
setInterval(neo4jKeepAlive, NEO4J_KEEPALIVE_INTERVAL);

// ============================================================================
// START SERVER
// ============================================================================

const slackStatus = process.env.SLACK_BOT_TOKEN ? 'enabled' : 'disabled';

// Initialize all services on startup
initializeServices().then(() => {
  // Run initial keep-alive after services are initialized
  setTimeout(neo4jKeepAlive, 5000);
}).catch(err => {
  console.log('[Startup] Service initialization error:', err.message);
});

// Load master context on startup
context.loadContext().then(() => {
  console.log('[Startup] Master context loaded');
}).catch(err => {
  console.log('[Startup] Master context load failed:', err.message);
});

// ============================================================================
// PHASE 3: GENERAL INTELLIGENCE - 20 NEW CAPABILITIES
// ============================================================================

// --- VISION SERVICE ---
app.post('/intelligence/vision/analyze-image', async (req, res) => {
  try {
    const { imageUrl, prompt, provider } = req.body;
    let result;
    switch (provider) {
      case 'claude': result = await vision.analyzeWithClaude(imageUrl, prompt); break;
      case 'gemini': result = await vision.analyzeWithGemini(imageUrl, prompt); break;
      default: result = await vision.analyzeWithGPT4V(imageUrl, prompt);
    }
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/vision/multi', async (req, res) => {
  try {
    const { imageUrl, prompt, providers } = req.body;
    const result = await vision.analyzeMultiProvider(imageUrl, prompt, providers);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/vision/extract-text', async (req, res) => {
  try {
    const { imageUrl } = req.body;
    const result = await vision.extractText(imageUrl);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/vision/compare', async (req, res) => {
  try {
    const { imageUrl1, imageUrl2, aspect } = req.body;
    const result = await vision.compareImages(imageUrl1, imageUrl2, aspect);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/intelligence/vision/status', (req, res) => res.json(vision.getStatus()));

// --- AUDIO SERVICE ---
app.post('/intelligence/audio/transcribe', async (req, res) => {
  try {
    const { audioPath, language, timestamps } = req.body;
    const result = await audio.transcribe(audioPath, { language, timestamps });
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/audio/translate', async (req, res) => {
  try {
    const { audioPath } = req.body;
    const result = await audio.translateToEnglish(audioPath);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/audio/analyze', async (req, res) => {
  try {
    const { audioPath, analysisType } = req.body;
    const result = await audio.analyzeAudio(audioPath, analysisType);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/audio/meeting-notes', async (req, res) => {
  try {
    const { audioPath } = req.body;
    const result = await audio.generateMeetingNotes(audioPath);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/intelligence/audio/status', (req, res) => res.json(audio.getStatus()));

// --- VIDEO SERVICE ---
app.post('/intelligence/video/analyze', async (req, res) => {
  try {
    const { videoUrl, prompt } = req.body;
    const result = await video.analyzeVideo(videoUrl, prompt);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/video/summarize', async (req, res) => {
  try {
    const { videoUrl, length } = req.body;
    const result = await video.summarizeVideo(videoUrl, length);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/video/transcript', async (req, res) => {
  try {
    const { videoUrl } = req.body;
    const result = await video.generateTranscript(videoUrl);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/video/search', async (req, res) => {
  try {
    const { videoUrl, query } = req.body;
    const result = await video.searchInVideo(videoUrl, query);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/intelligence/video/status', (req, res) => res.json(video.getStatus()));

// --- DOCUMENT SERVICE ---
app.post('/intelligence/documents/parse', async (req, res) => {
  try {
    const { pdfSource, prompt } = req.body;
    const result = await documents.parsePDF(pdfSource, prompt);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/documents/extract', async (req, res) => {
  try {
    const { pdfSource, schema } = req.body;
    const result = await documents.extractStructuredData(pdfSource, schema);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/documents/analyze-contract', async (req, res) => {
  try {
    const { pdfSource } = req.body;
    const result = await documents.analyzeContract(pdfSource);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/documents/analyze-financial', async (req, res) => {
  try {
    const { pdfSource } = req.body;
    const result = await documents.analyzeFinancial(pdfSource);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/documents/compare', async (req, res) => {
  try {
    const { doc1Source, doc2Source } = req.body;
    const result = await documents.compareDocuments(doc1Source, doc2Source);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/documents/ask', async (req, res) => {
  try {
    const { pdfSource, question } = req.body;
    const result = await documents.askDocument(pdfSource, question);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/intelligence/documents/status', (req, res) => res.json(documents.getStatus()));

// --- SYMBOLIC REASONING SERVICE ---
app.post('/intelligence/symbolic/evaluate', (req, res) => {
  try {
    const { expression, variables } = req.body;
    const result = symbolic.evaluateLogic(expression, variables);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/symbolic/truth-table', (req, res) => {
  try {
    const { expression, variables } = req.body;
    const result = symbolic.truthTable(expression, variables);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/symbolic/assert-fact', (req, res) => {
  try {
    const { fact } = req.body;
    const result = symbolic.assertFact(fact);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/symbolic/query', (req, res) => {
  try {
    const { query } = req.body;
    const result = symbolic.query(query);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/symbolic/prove', async (req, res) => {
  try {
    const { theorem, axioms } = req.body;
    const result = await symbolic.proveTheorem(theorem, axioms);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/symbolic/analogy', async (req, res) => {
  try {
    const { a, b, c } = req.body;
    const result = await symbolic.completeAnalogy(a, b, c);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/intelligence/symbolic/kb-stats', (req, res) => res.json(symbolic.getKnowledgeBaseStats()));
app.get('/intelligence/symbolic/status', (req, res) => res.json(symbolic.getStatus()));

// --- PROBABILISTIC REASONING SERVICE ---
app.post('/intelligence/probabilistic/bayes', (req, res) => {
  try {
    const { priorA, likelihoodBgivenA, priorB } = req.body;
    const result = probabilistic.bayesTheorem(priorA, likelihoodBgivenA, priorB);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/probabilistic/bayes-complement', (req, res) => {
  try {
    const { priorA, truePositiveRate, falsePositiveRate } = req.body;
    const result = probabilistic.bayesWithComplement(priorA, truePositiveRate, falsePositiveRate);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/probabilistic/counterfactual', async (req, res) => {
  try {
    const { factual, counterfactual, context } = req.body;
    const result = await probabilistic.analyzeCounterfactual(factual, counterfactual, context);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/probabilistic/expected-value', (req, res) => {
  try {
    const { options } = req.body;
    const result = probabilistic.expectedValueAnalysis(options);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/probabilistic/uncertainty', (req, res) => {
  try {
    const { samples } = req.body;
    const result = probabilistic.quantifyUncertainty(samples);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/probabilistic/monte-carlo', (req, res) => {
  try {
    const { trials, scenarios } = req.body;
    const result = probabilistic.monteCarloSimulation(trials, scenarios);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/intelligence/probabilistic/status', (req, res) => res.json(probabilistic.getStatus()));

// --- METACOGNITION SERVICE ---
app.post('/intelligence/metacognition/assess-confidence', async (req, res) => {
  try {
    const { question, answer, reasoning } = req.body;
    const result = await metacognition.assessConfidence(question, answer, reasoning);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/metacognition/reflect', async (req, res) => {
  try {
    const { problem, steps, conclusion } = req.body;
    const result = await metacognition.reflectOnReasoning(problem, steps, conclusion);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/metacognition/detect-biases', async (req, res) => {
  try {
    const { reasoning } = req.body;
    const result = await metacognition.detectBiases(reasoning);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/metacognition/decompose-goal', async (req, res) => {
  try {
    const { goal, context } = req.body;
    const result = await metacognition.decomposeGoal(goal, context);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/intelligence/metacognition/cognitive-load', (req, res) => res.json(metacognition.trackCognitiveLoad()));
app.get('/intelligence/metacognition/state', (req, res) => res.json(metacognition.getCognitiveState()));
app.get('/intelligence/metacognition/status', (req, res) => res.json(metacognition.getStatus()));

// --- LEARNING SERVICE ---
app.post('/intelligence/learning/analyze-task', async (req, res) => {
  try {
    const { task, examples } = req.body;
    const result = await learning.analyzeTaskForLearning(task, examples);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/learning/store-knowledge', async (req, res) => {
  try {
    const { category, knowledge, metadata } = req.body;
    const result = await learning.storeKnowledge(category, knowledge, metadata);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/intelligence/learning/retrieve/:category', async (req, res) => {
  try {
    const result = await learning.retrieveKnowledge(req.params.category, req.query.query);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/learning/transfer', async (req, res) => {
  try {
    const { sourceDomain, targetDomain, context } = req.body;
    const result = await learning.transferKnowledge(sourceDomain, targetDomain, context);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/learning/feedback', async (req, res) => {
  try {
    const { responseId, feedback, context } = req.body;
    const result = await learning.recordFeedback(responseId, feedback, context);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/intelligence/learning/preferences/:userId', (req, res) => res.json(learning.getUserPreferences(req.params.userId)));
app.get('/intelligence/learning/state', (req, res) => res.json(learning.getLearningState()));
app.get('/intelligence/learning/status', (req, res) => res.json(learning.getStatus()));

// --- SCIENTIFIC SERVICE ---
app.get('/intelligence/scientific/arxiv', async (req, res) => {
  try {
    const { query, maxResults, sortBy } = req.query;
    const result = await scientific.searchArxiv(query, parseInt(maxResults) || 10, sortBy);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/intelligence/scientific/pubmed', async (req, res) => {
  try {
    const { query, maxResults } = req.query;
    const result = await scientific.searchPubmed(query, parseInt(maxResults) || 10);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/intelligence/scientific/wikipedia', async (req, res) => {
  try {
    const { query, limit } = req.query;
    const result = await scientific.searchWikipedia(query, parseInt(limit) || 10);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/intelligence/scientific/semantic-scholar', async (req, res) => {
  try {
    const { query, limit } = req.query;
    const result = await scientific.searchSemanticScholar(query, parseInt(limit) || 10);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/scientific/multi-search', async (req, res) => {
  try {
    const { query, sources } = req.body;
    const result = await scientific.multiSourceSearch(query, sources);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/scientific/synthesize', async (req, res) => {
  try {
    const { query, maxPapers } = req.body;
    const result = await scientific.synthesizeResearch(query, maxPapers);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/scientific/fact-check', async (req, res) => {
  try {
    const { claim } = req.body;
    const result = await scientific.factCheck(claim);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/intelligence/scientific/status', (req, res) => res.json(scientific.getStatus()));

// --- EXPLAINABILITY SERVICE ---
app.post('/intelligence/explainability/explain', async (req, res) => {
  try {
    const { question, answer, context } = req.body;
    const result = await explainability.explainReasoning(question, answer, context);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/explainability/chain-of-thought', async (req, res) => {
  try {
    const { problem } = req.body;
    const result = await explainability.chainOfThought(problem);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/explainability/feature-importance', async (req, res) => {
  try {
    const { features, decision } = req.body;
    const result = await explainability.analyzeFeatureImportance(features, decision);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/explainability/counterfactual', async (req, res) => {
  try {
    const { features, currentOutcome, desiredOutcome } = req.body;
    const result = await explainability.generateCounterfactual(features, currentOutcome, desiredOutcome);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/explainability/what-if', async (req, res) => {
  try {
    const { scenario, modifications } = req.body;
    const result = await explainability.whatIfAnalysis(scenario, modifications);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/explainability/audit', async (req, res) => {
  try {
    const { decision, factors, stakeholders } = req.body;
    const result = await explainability.createDecisionAudit(decision, factors, stakeholders);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/intelligence/explainability/for-audience', async (req, res) => {
  try {
    const { decision, reasoning, audience } = req.body;
    const result = await explainability.explainForAudience(decision, reasoning, audience);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/intelligence/explainability/history', (req, res) => res.json(explainability.getExplanationHistory(parseInt(req.query.limit) || 20)));
app.get('/intelligence/explainability/status', (req, res) => res.json(explainability.getStatus()));

// --- UNIFIED PHASE 3 STATUS ---
app.get('/intelligence/v3/status', (req, res) => {
  res.json({
    phase: 'Phase 3: General Intelligence - 20 Capabilities',
    services: {
      vision: vision.getStatus(),
      audio: audio.getStatus(),
      video: video.getStatus(),
      documents: documents.getStatus(),
      symbolic: symbolic.getStatus(),
      probabilistic: probabilistic.getStatus(),
      metacognition: metacognition.getStatus(),
      learning: learning.getStatus(),
      scientific: scientific.getStatus(),
      explainability: explainability.getStatus()
    },
    timestamp: new Date().toISOString()
  });
});

// Pre-warm AI providers on startup (run in parallel for speed)
async function prewarmProviders() {
  console.log('[Prewarm] Starting AI provider warm-up...');
  const start = Date.now();
  const warmupPromises = [];

  // Groq warm-up (fastest)
  if (process.env.GROQ_API_KEY) {
    warmupPromises.push(
      aiProviders.fastChat('ping', { system: 'respond with ok' })
        .then(() => console.log('[Prewarm] Groq ready'))
        .catch(() => console.log('[Prewarm] Groq unavailable'))
    );
  }

  // Gemini warm-up
  if (process.env.GEMINI_API_KEY) {
    warmupPromises.push(
      ai.askGemini('ping')
        .then(() => console.log('[Prewarm] Gemini ready'))
        .catch(() => console.log('[Prewarm] Gemini unavailable'))
    );
  }

  await Promise.allSettled(warmupPromises);
  console.log(`[Prewarm] Complete in ${Date.now() - start}ms`);
}

// Run pre-warm (don't await - let server start)
prewarmProviders();

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║           CLOUD ORCHESTRATOR - Running                       ║
╠══════════════════════════════════════════════════════════════╣
║  Port:  ${PORT}                                                 ║
║  Env:   ${process.env.NODE_ENV || 'development'}                                       ║
║  Slack: ${slackStatus}                                          ║
║  Time:  ${new Date().toISOString()}              ║
╚══════════════════════════════════════════════════════════════╝

Endpoints:
  GET  /health              - System health check
  POST /ai/:provider        - Single AI query
  POST /ai/all              - Query all 3 AIs
  POST /ai/consensus        - Multi-AI consensus
  POST /review              - Code review panel
  GET  /github/repos        - List all GitHub repos
  GET  /github/repos/:o/:r  - Get repo details
  GET  /github/search       - Search code
  POST /slack/commands      - Slack slash commands
  POST /slack/events        - Slack events

Slack Commands:
  AI:     /ask /review /challenge /consensus /health /usage
  GitHub: /repos /commits /files /readfile /issues /codesearch
`);
});

// ============================================================================
// GLOBAL ERROR HANDLERS - Prevent silent crashes
// ============================================================================

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Promise Rejection:', reason);
  console.error('Promise:', promise);
  // Don't exit - log and continue (production resilience)
});

process.on('uncaughtException', (error) => {
  console.error('[CRITICAL] Uncaught Exception:', error);
  // For uncaught exceptions, we should exit after logging
  // Give time to flush logs before exit
  setTimeout(() => process.exit(1), 1000);
});

// Graceful shutdown on SIGTERM (Railway sends this)
process.on('SIGTERM', async () => {
  console.log('[Shutdown] SIGTERM received, closing connections...');
  try {
    await neo4j.closeNeo4j();
    console.log('[Shutdown] Neo4j closed');
  } catch (e) {
    console.log('[Shutdown] Neo4j close error:', e.message);
  }
  process.exit(0);
});

export default app;
