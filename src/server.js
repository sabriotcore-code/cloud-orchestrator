import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

import * as db from './db/index.js';
import * as ai from './services/ai.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// MIDDLEWARE
// ============================================================================

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
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

    res.json({
      status: 'healthy',
      database: 'connected',
      providers,
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

// Single AI query
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
    default:
      return res.status(400).json({ error: 'Invalid provider. Use: claude, gpt, or gemini' });
  }

  res.json(result);
});

// Multi-AI query (parallel)
app.post('/ai/all', async (req, res) => {
  const { content, promptType = 'general' } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  const results = await ai.askAll(content, promptType);
  res.json(results);
});

// Multi-AI with consensus
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
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║           CLOUD ORCHESTRATOR - Running                       ║
╠══════════════════════════════════════════════════════════════╣
║  Port: ${PORT}                                                  ║
║  Env:  ${process.env.NODE_ENV || 'development'}                                        ║
║  Time: ${new Date().toISOString()}               ║
╚══════════════════════════════════════════════════════════════╝

Endpoints:
  GET  /health              - System health check
  POST /ai/:provider        - Single AI query (claude/gpt/gemini)
  POST /ai/all              - Query all 3 AIs in parallel
  POST /ai/consensus        - Multi-AI with consensus
  POST /review              - Code review (like original orchestrator)
  POST /chat                - Chat with memory
  GET  /chat/:sessionId     - Get conversation history
  POST /memory              - Store key-value
  GET  /memory/:key         - Retrieve value
  GET  /usage               - Usage statistics
`);
});

export default app;
