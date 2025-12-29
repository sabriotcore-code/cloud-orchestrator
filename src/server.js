import dotenv from 'dotenv';
dotenv.config(); // Load env first

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { v4 as uuidv4 } from 'uuid';

import * as db from './db/index.js';
import * as ai from './services/ai.js';
import * as github from './services/github.js';
import { initSlack, slackApp } from './services/slack.js';

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

    // Check GitHub
    const githubUser = await github.getAuthenticatedUser();

    res.json({
      status: 'healthy',
      database: 'connected',
      providers,
      github: githubUser ? { connected: true, user: githubUser.login } : { connected: false },
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
// SLACK INTEGRATION
// ============================================================================

// Initialize Slack if credentials are provided
initSlack(app);

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
        result = { health: ai.getProviderStatus() };
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

// Format Slack response
function formatSlackResponse(command, result) {
  if (result.error) return `❌ ${result.error}`;
  if (result.health) {
    const h = result.health;
    return `🏥 *Health:* Claude ${h.claude ? '✅' : '❌'} | GPT ${h.gpt ? '✅' : '❌'} | Gemini ${h.gemini ? '✅' : '❌'}`;
  }
  if (result.consensus) {
    return `🤝 *Consensus:*\n${result.consensus.response || 'No consensus'}`;
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
// START SERVER
// ============================================================================

const slackStatus = process.env.SLACK_BOT_TOKEN ? 'enabled' : 'disabled';

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

export default app;
