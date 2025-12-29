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
import * as memory from './services/memory.js';
import * as context from './services/context.js';
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
      google: google.isConfigured(),
      webSearch: web.isConfigured(),
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
// MASTER AI COMMAND HANDLER
// ============================================================================

async function handleMasterCommand(query, userId = 'default') {
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

  // Get conversation context
  const conversationContext = await memory.getContextString(userId, 3);

  // Get master context summary
  const masterContextSummary = await context.getContextSummary();

  // Use Claude to understand intent and extract parameters
  const intentPrompt = `You are a smart command router. Analyze this user request and determine what action to take.

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

=== MASTER CONTEXT (What I know about Matt's projects) ===
${masterContextSummary}
===

${conversationContext ? `Recent conversation:\n${conversationContext}\n` : ''}

User request: "${query}"

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
- "what does rei-dashboard do" → {"action": "ASK_AI", "params": {"question": "What does the rei-dashboard project do? It's a real estate investment dashboard hosted on Netlify."}}
- "what is this for" → {"action": "ASK_AI", "params": {"question": "Based on context, explain what this is for"}}
- "explain the cloud-orchestrator" → {"action": "ASK_AI", "params": {"question": "Explain the cloud-orchestrator project - it's a multi-AI system that queries Claude, GPT, and Gemini"}}
- "search the web for nodejs" → {"action": "WEB_SEARCH", "params": {"query": "nodejs"}}
- "what is 2+2" → {"action": "ASK_AI", "params": {"question": "what is 2+2"}}`;

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

      case 'ASK_AI':
        const askResults = await ai.askAll(intent.params.question, 'general');
        const consensus = await ai.buildConsensus(askResults, 'weighted');
        return { master: {
          response: `🤖 *AI Consensus:*\n${consensus.response}\n\n` +
            `_Sources: ${consensus.sources?.join(', ') || consensus.winner}_`
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

// Format Slack response
function formatSlackResponse(command, result) {
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
// START SERVER
// ============================================================================

const slackStatus = process.env.SLACK_BOT_TOKEN ? 'enabled' : 'disabled';

// Load master context on startup
context.loadContext().then(() => {
  console.log('[Startup] Master context loaded');
}).catch(err => {
  console.log('[Startup] Master context load failed:', err.message);
});

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
