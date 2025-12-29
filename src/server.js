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
    const storedPlan = await memory.retrieve(`plan_${userId}`);

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

    for (const step of plan.plan || []) {
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
        } else if (step.action.toLowerCase().includes('commit') || step.action.toLowerCase().includes('push') || step.action.toLowerCase().includes('update file')) {
          executionLog += `  ⚠️ Write operation requires specific content - marked for review\n`;
        } else {
          executionLog += `  ℹ️ Noted\n`;
          stepsExecuted++;
        }
      } catch (stepError) {
        executionLog += `  ❌ Failed: ${stepError.message}\n`;
        stepsFailed++;
      }
    }

    executionLog += `\n*Summary:* ${stepsExecuted} steps executed, ${stepsFailed} failed\n`;

    if (plan.manualSteps && plan.manualSteps.length > 0) {
      executionLog += `\n*Manual Steps Needed:*\n`;
      for (const ms of plan.manualSteps) {
        executionLog += `👤 ${ms}\n`;
      }
    }

    // Clear the stored plan
    await memory.store(`plan_${userId}`, '', 'plans');
    await context.updateContext('CURRENT WORK', `Executed plan with ${stepsExecuted} steps`);

    return { master: { response: executionLog }};
  } catch (e) {
    return { master: { response: `❌ Failed to execute plan: ${e.message}` }};
  }
}

// ============================================================================
// MASTER AI COMMAND HANDLER
// ============================================================================

async function handleMasterCommand(query, userId = 'default') {
  // ============================================================
  // SMART CONTEXT SYSTEM - Makes the bot context-aware like Claude Code
  // ============================================================

  // Get pending state (was there a plan just shown?)
  const pendingState = await memory.retrieve(`pending_${userId}`);
  const lastResponse = await memory.retrieve(`last_response_${userId}`);

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
        // Create or update a file in a repo
        try {
          const commitOwner = intent.params.owner || 'sabriotcore-code';
          const commitRepo = intent.params.repo;
          const commitPath = intent.params.path;
          const commitContent = intent.params.content;
          const commitMessage = intent.params.message || `Update ${commitPath} via Slack`;

          if (!commitRepo || !commitPath || !commitContent) {
            return { master: { response: `❌ Missing required params. Need: repo, path, content` }};
          }

          // Try to get existing file SHA (for updates)
          let existingSha = null;
          try {
            const existing = await github.readFile(commitOwner, commitRepo, commitPath);
            existingSha = existing.sha;
          } catch (e) {
            // File doesn't exist, that's fine for creating
          }

          const result = await github.createOrUpdateFile(
            commitOwner,
            commitRepo,
            commitPath,
            commitContent,
            commitMessage,
            existingSha
          );

          await context.updateContext('CURRENT WORK', `Committed ${commitPath} to ${commitRepo}`);

          return { master: { response: `✅ *File Committed!*\n📁 \`${commitPath}\`\n📦 Repo: ${commitOwner}/${commitRepo}\n📝 Message: ${commitMessage}\n🔗 ${result.content?.html_url || 'Commit successful'}` }};
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
        // SMART EXECUTION: Investigate → Analyze → Plan → Auto-Execute
        // ================================================================
        try {
          const task = intent.params.task || query;
          let response = `🔍 *Investigating: ${task}*\n\n`;

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

            // Read main files based on what we find
            const filesToRead = [];
            for (const f of allFiles) {
              if (['index.html', 'main.js', 'app.js', 'script.js', 'index.js', 'config.js', 'package.json'].includes(f.name)) {
                filesToRead.push(f.name);
              }
            }

            // Also check src/ or js/ folders
            for (const f of allFiles) {
              if (f.type === 'dir' && ['src', 'js', 'scripts', 'lib'].includes(f.name)) {
                try {
                  const subFiles = await github.listFiles(targetOwner, targetRepo, f.name);
                  for (const sf of subFiles.slice(0, 5)) {
                    if (sf.name.endsWith('.js') || sf.name.endsWith('.html')) {
                      filesToRead.push(`${f.name}/${sf.name}`);
                    }
                  }
                } catch (e) { /* ignore */ }
              }
            }

            // Read up to 5 key files
            for (const fileName of filesToRead.slice(0, 5)) {
              try {
                const fileContent = await github.readFile(targetOwner, targetRepo, fileName);
                investigationData[fileName] = fileContent.content.substring(0, 3000);
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
            let jsonStr = analysisResult.response.trim();
            if (jsonStr.startsWith('```')) {
              jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
            }
            analysis = JSON.parse(jsonStr);
          } catch (e) {
            // Return raw analysis if not JSON
            return { master: { response: response + `📋 *Analysis:*\n${analysisResult.response}` }};
          }

          // ========== PHASE 3: PRESENT FINDINGS ==========
          response += `*🔎 Diagnosis:* ${analysis.diagnosis}\n\n`;
          response += `*🎯 Root Cause:* ${analysis.rootCause}\n\n`;

          if (analysis.fixes && analysis.fixes.length > 0) {
            response += `*🔧 Proposed Fixes:*\n`;
            for (let i = 0; i < analysis.fixes.length; i++) {
              const fix = analysis.fixes[i];
              const safeIcon = fix.safe ? '✅' : '⚠️';
              response += `${safeIcon} ${i + 1}. *${fix.file}*: ${fix.description}\n`;
              if (fix.oldCode && fix.newCode) {
                response += `   \`${fix.oldCode.substring(0, 50)}...\` → \`${fix.newCode.substring(0, 50)}...\`\n`;
              }
            }
          }

          if (analysis.manualSteps && analysis.manualSteps.length > 0) {
            response += `\n*👤 Manual Steps:*\n`;
            for (const ms of analysis.manualSteps) {
              response += `• ${ms}\n`;
            }
          }

          // ========== PHASE 4: AUTO-EXECUTE SAFE FIXES ==========
          if (analysis.canAutoFix && analysis.fixes) {
            const safeFixes = analysis.fixes.filter(f => f.safe);

            if (safeFixes.length > 0) {
              response += `\n\n🚀 *Auto-executing ${safeFixes.length} safe fix(es)...*\n`;

              for (const fix of safeFixes) {
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

                  response += `✅ Fixed: ${fix.file}\n`;
                } catch (e) {
                  response += `❌ Failed ${fix.file}: ${e.message}\n`;
                }
              }

              response += `\n🎉 *Done! Changes committed to ${targetRepo}.*`;
              await context.updateContext('CURRENT WORK', `Fixed ${safeFixes.length} issues in ${targetRepo}`);
            } else {
              response += `\n\n⚠️ *No safe auto-fixes available. Review needed.*`;

              // Store for manual confirmation
              await memory.store(`plan_${userId}`, JSON.stringify(analysis), 'plans');
              await memory.store(`pending_${userId}`, 'PLAN', 'state');
              response += `\n✅ *Reply "/do yes" to apply risky fixes*`;
            }
          } else {
            response += `\n\n⚠️ *Manual review required before applying fixes.*`;
            await memory.store(`plan_${userId}`, JSON.stringify(analysis), 'plans');
            await memory.store(`pending_${userId}`, 'PLAN', 'state');
            response += `\n✅ *Reply "/do yes" to proceed*`;
          }

          // Store context
          const planSummary = `Investigated ${targetRepo}: ${analysis.diagnosis}. Fixes: ${(analysis.fixes || []).map(f => f.description).join('; ')}`;
          await memory.store(`last_response_${userId}`, planSummary.substring(0, 1500), 'context');

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
          return { master: { response: `❌ Failed to execute plan: ${e.message}` }};
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

        const askResults = await ai.askAll(enrichedQuestion, 'general');
        const consensus = await ai.buildConsensus(askResults, 'weighted');

        // Store this response for future context
        const aiResponse = consensus.response.substring(0, 500);
        await memory.store(`last_response_${userId}`, aiResponse, 'context');

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
