import pkg from '@slack/bolt';
const { App } = pkg;
import * as ai from './ai.js';
import * as github from './github.js';
import * as db from '../db/index.js';

let slackApp = null;

// ============================================================================
// INITIALIZE SLACK APP
// ============================================================================

export function initSlack(expressApp) {
  if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_SIGNING_SECRET) {
    console.log('[Slack] Missing SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET - Slack disabled');
    return null;
  }

  slackApp = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    // Use Express app's receiver for HTTP mode
    socketMode: false,
  });

  // Register event handlers
  registerCommands();
  registerEvents();
  registerActions();

  console.log('[Slack] Bot initialized');
  return slackApp;
}

// ============================================================================
// SLASH COMMANDS
// ============================================================================

function registerCommands() {
  // /ask - Ask all 3 AIs a question
  slackApp.command('/ask', async ({ command, ack, respond }) => {
    await ack();

    const query = command.text.trim();
    if (!query) {
      await respond('Usage: `/ask <your question>`');
      return;
    }

    await respond({
      text: `🤔 Asking Claude, GPT, and Gemini: "${query.substring(0, 50)}..."`,
      response_type: 'ephemeral'
    });

    try {
      const results = await ai.askAll(query, 'general');
      const response = formatMultiAiResponse(results, query);
      await respond({ blocks: response, response_type: 'in_channel' });
    } catch (error) {
      await respond(`❌ Error: ${error.message}`);
    }
  });

  // /review - Code review with all 3 AIs
  slackApp.command('/review', async ({ command, ack, respond }) => {
    await ack();

    const content = command.text.trim();
    if (!content) {
      await respond('Usage: `/review <code or description>`');
      return;
    }

    await respond({
      text: '🔍 Running multi-AI code review...',
      response_type: 'ephemeral'
    });

    try {
      const results = await ai.askAll(content, 'review');
      const response = formatReviewResponse(results);
      await respond({ blocks: response, response_type: 'in_channel' });
    } catch (error) {
      await respond(`❌ Error: ${error.message}`);
    }
  });

  // /challenge - Challenge mode review
  slackApp.command('/challenge', async ({ command, ack, respond }) => {
    await ack();

    const content = command.text.trim();
    if (!content) {
      await respond('Usage: `/challenge <plan or approach>`');
      return;
    }

    await respond({
      text: '⚔️ Challenging your approach with 3 AIs...',
      response_type: 'ephemeral'
    });

    try {
      const results = await ai.askAll(content, 'challenge');
      const response = formatChallengeResponse(results);
      await respond({ blocks: response, response_type: 'in_channel' });
    } catch (error) {
      await respond(`❌ Error: ${error.message}`);
    }
  });

  // /consensus - Get AI consensus
  slackApp.command('/consensus', async ({ command, ack, respond }) => {
    await ack();

    const query = command.text.trim();
    if (!query) {
      await respond('Usage: `/consensus <question>`');
      return;
    }

    await respond({
      text: '🤝 Building AI consensus...',
      response_type: 'ephemeral'
    });

    try {
      const results = await ai.askAll(query, 'general');
      const consensus = await ai.buildConsensus(results, 'weighted');

      const blocks = [
        {
          type: 'header',
          text: { type: 'plain_text', text: '🤝 AI Consensus' }
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Question:* ${query.substring(0, 200)}` }
        },
        { type: 'divider' },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: consensus.response || 'No consensus reached' }
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `Method: ${consensus.method} | Winner: ${consensus.winner}` }
          ]
        }
      ];

      await respond({ blocks, response_type: 'in_channel' });
    } catch (error) {
      await respond(`❌ Error: ${error.message}`);
    }
  });

  // /usage - Show usage stats
  slackApp.command('/usage', async ({ command, ack, respond }) => {
    await ack();

    try {
      const today = await db.getTodayUsage();

      let text = '*📊 Today\'s AI Usage:*\n';
      if (today.length === 0) {
        text += 'No usage recorded today.';
      } else {
        let totalCost = 0;
        for (const row of today) {
          text += `• ${row.provider}: ${row.calls} calls, $${parseFloat(row.cost).toFixed(4)}\n`;
          totalCost += parseFloat(row.cost);
        }
        text += `\n*Total: $${totalCost.toFixed(4)}*`;
      }

      await respond({ text, response_type: 'ephemeral' });
    } catch (error) {
      await respond(`❌ Error: ${error.message}`);
    }
  });

  // /health - System health check
  slackApp.command('/health', async ({ command, ack, respond }) => {
    await ack();

    const providers = ai.getProviderStatus();
    const githubConnected = github.isConfigured();
    const status = Object.values(providers).every(v => v) ? '✅ All systems operational' : '⚠️ Some providers unavailable';

    const text = `*🏥 System Health:*\n${status}\n\n` +
      `• Claude: ${providers.claude ? '✅' : '❌'}\n` +
      `• GPT-4o: ${providers.gpt ? '✅' : '❌'}\n` +
      `• Gemini: ${providers.gemini ? '✅' : '❌'}\n` +
      `• GitHub: ${githubConnected ? '✅' : '❌'}`;

    await respond({ text, response_type: 'ephemeral' });
  });

  // /repos - List all GitHub repos
  slackApp.command('/repos', async ({ command, ack, respond }) => {
    await ack();

    if (!github.isConfigured()) {
      await respond('❌ GitHub not configured. Add GITHUB_TOKEN to environment.');
      return;
    }

    await respond({ text: '📂 Fetching repositories...', response_type: 'ephemeral' });

    try {
      const repos = await github.listRepos(20);
      let text = '*📂 Your GitHub Repositories:*\n\n';
      for (const repo of repos) {
        text += `• *${repo.name}* ${repo.isPrivate ? '🔒' : '🌐'}\n`;
        if (repo.description) text += `  _${repo.description}_\n`;
      }
      await respond({ text, response_type: 'in_channel' });
    } catch (error) {
      await respond(`❌ Error: ${error.message}`);
    }
  });

  // /commits - Get recent commits
  slackApp.command('/commits', async ({ command, ack, respond }) => {
    await ack();

    if (!github.isConfigured()) {
      await respond('❌ GitHub not configured. Add GITHUB_TOKEN to environment.');
      return;
    }

    const parts = command.text.trim().split('/');
    if (parts.length !== 2) {
      await respond('Usage: `/commits owner/repo`\nExample: `/commits sabriotcore-code/cloud-orchestrator`');
      return;
    }

    const [owner, repo] = parts;
    await respond({ text: `📜 Fetching commits for ${owner}/${repo}...`, response_type: 'ephemeral' });

    try {
      const commits = await github.getCommits(owner, repo, 10);
      let text = `*📜 Recent commits for ${owner}/${repo}:*\n\n`;
      for (const c of commits) {
        text += `• \`${c.sha}\` ${c.message}\n  _by ${c.author}_\n`;
      }
      await respond({ text, response_type: 'in_channel' });
    } catch (error) {
      await respond(`❌ Error: ${error.message}`);
    }
  });

  // /files - List files in a repo
  slackApp.command('/files', async ({ command, ack, respond }) => {
    await ack();

    if (!github.isConfigured()) {
      await respond('❌ GitHub not configured. Add GITHUB_TOKEN to environment.');
      return;
    }

    const text = command.text.trim();
    const match = text.match(/^([^\/]+)\/([^\s]+)(?:\s+(.*))?$/);
    if (!match) {
      await respond('Usage: `/files owner/repo [path]`\nExample: `/files sabriotcore-code/cloud-orchestrator src`');
      return;
    }

    const [, owner, repo, path = ''] = match;
    await respond({ text: `📁 Fetching files from ${owner}/${repo}/${path}...`, response_type: 'ephemeral' });

    try {
      const files = await github.listFiles(owner, repo, path);
      let response = `*📁 Files in ${owner}/${repo}/${path || 'root'}:*\n\n`;
      for (const f of files) {
        const icon = f.type === 'dir' ? '📂' : '📄';
        response += `${icon} ${f.name}\n`;
      }
      await respond({ text: response, response_type: 'in_channel' });
    } catch (error) {
      await respond(`❌ Error: ${error.message}`);
    }
  });

  // /readfile - Read file content
  slackApp.command('/readfile', async ({ command, ack, respond }) => {
    await ack();

    if (!github.isConfigured()) {
      await respond('❌ GitHub not configured. Add GITHUB_TOKEN to environment.');
      return;
    }

    const text = command.text.trim();
    const match = text.match(/^([^\/]+)\/([^\s]+)\s+(.+)$/);
    if (!match) {
      await respond('Usage: `/readfile owner/repo path/to/file`\nExample: `/readfile sabriotcore-code/cloud-orchestrator package.json`');
      return;
    }

    const [, owner, repo, path] = match;
    await respond({ text: `📖 Reading ${path}...`, response_type: 'ephemeral' });

    try {
      const file = await github.readFile(owner, repo, path);
      const preview = file.content.substring(0, 2000);
      const truncated = file.content.length > 2000 ? '\n\n_(truncated - file too large)_' : '';

      await respond({
        text: `*📖 ${path}* (${file.size} bytes)\n\`\`\`\n${preview}${truncated}\n\`\`\``,
        response_type: 'in_channel'
      });
    } catch (error) {
      await respond(`❌ Error: ${error.message}`);
    }
  });

  // /issues - List issues
  slackApp.command('/issues', async ({ command, ack, respond }) => {
    await ack();

    if (!github.isConfigured()) {
      await respond('❌ GitHub not configured. Add GITHUB_TOKEN to environment.');
      return;
    }

    const parts = command.text.trim().split('/');
    if (parts.length !== 2) {
      await respond('Usage: `/issues owner/repo`\nExample: `/issues sabriotcore-code/cloud-orchestrator`');
      return;
    }

    const [owner, repo] = parts;
    await respond({ text: `🎫 Fetching issues for ${owner}/${repo}...`, response_type: 'ephemeral' });

    try {
      const issues = await github.listIssues(owner, repo, 'open', 15);
      if (issues.length === 0) {
        await respond({ text: `*🎫 No open issues in ${owner}/${repo}*`, response_type: 'in_channel' });
        return;
      }

      let text = `*🎫 Open issues in ${owner}/${repo}:*\n\n`;
      for (const i of issues) {
        const labels = i.labels.length > 0 ? ` [${i.labels.join(', ')}]` : '';
        text += `• #${i.number} ${i.title}${labels}\n  _by ${i.author}_\n`;
      }
      await respond({ text, response_type: 'in_channel' });
    } catch (error) {
      await respond(`❌ Error: ${error.message}`);
    }
  });

  // /codesearch - Search code across repos
  slackApp.command('/codesearch', async ({ command, ack, respond }) => {
    await ack();

    if (!github.isConfigured()) {
      await respond('❌ GitHub not configured. Add GITHUB_TOKEN to environment.');
      return;
    }

    const query = command.text.trim();
    if (!query) {
      await respond('Usage: `/search <code pattern>`\nExample: `/search askClaude`');
      return;
    }

    await respond({ text: `🔍 Searching for "${query}"...`, response_type: 'ephemeral' });

    try {
      const results = await github.searchCode(query, 10);
      if (results.length === 0) {
        await respond({ text: `*🔍 No results for "${query}"*`, response_type: 'in_channel' });
        return;
      }

      let text = `*🔍 Search results for "${query}":*\n\n`;
      for (const r of results) {
        text += `• *${r.repo}* - ${r.path}\n`;
      }
      await respond({ text, response_type: 'in_channel' });
    } catch (error) {
      await respond(`❌ Error: ${error.message}`);
    }
  });
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

function registerEvents() {
  // Respond to app mentions
  slackApp.event('app_mention', async ({ event, say }) => {
    const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();

    if (!text) {
      await say('👋 Hi! Try `/ask`, `/review`, `/challenge`, or `/consensus`');
      return;
    }

    await say('🤔 Thinking...');

    try {
      const results = await ai.askAll(text, 'general');
      const consensus = await ai.buildConsensus(results, 'weighted');
      await say(`*AI Response:*\n${consensus.response}`);
    } catch (error) {
      await say(`❌ Error: ${error.message}`);
    }
  });

  // React to messages in specific channels (optional)
  slackApp.message(async ({ message, say }) => {
    // Only respond if message starts with "AI:" prefix
    if (message.text && message.text.startsWith('AI:')) {
      const query = message.text.substring(3).trim();

      try {
        const results = await ai.askAll(query, 'general');
        const consensus = await ai.buildConsensus(results, 'weighted');
        await say({ text: consensus.response, thread_ts: message.ts });
      } catch (error) {
        await say({ text: `❌ ${error.message}`, thread_ts: message.ts });
      }
    }
  });
}

// ============================================================================
// INTERACTIVE ACTIONS
// ============================================================================

function registerActions() {
  // Button clicks, select menus, etc.
  slackApp.action('select_provider', async ({ body, ack, respond }) => {
    await ack();
    const provider = body.actions[0].selected_option.value;
    await respond(`Selected provider: ${provider}`);
  });
}

// ============================================================================
// RESPONSE FORMATTERS
// ============================================================================

function formatMultiAiResponse(results, query) {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🤖 Multi-AI Response' }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Query:* ${query.substring(0, 200)}` }
    },
    { type: 'divider' }
  ];

  for (const [provider, result] of Object.entries(results)) {
    const icon = result.success ? '✅' : '❌';
    const name = provider.charAt(0).toUpperCase() + provider.slice(1);

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${icon} *${name}* (${result.latencyMs}ms, $${(result.costUsd || 0).toFixed(4)})\n${
          result.success ? result.response.substring(0, 500) : `Error: ${result.error}`
        }`
      }
    });
  }

  const totalCost = Object.values(results)
    .filter(r => r.success)
    .reduce((sum, r) => sum + (r.costUsd || 0), 0);

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `💰 Total: $${totalCost.toFixed(4)}` }]
  });

  return blocks;
}

function formatReviewResponse(results) {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🔍 Code Review Panel' }
    },
    { type: 'divider' }
  ];

  const providers = ['claude', 'gpt', 'gemini'];
  const names = { claude: 'Claude', gpt: 'GPT-4o', gemini: 'Gemini' };

  for (const provider of providers) {
    const result = results[provider];
    if (result.success) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${names[provider]}:*\n${result.response.substring(0, 800)}`
        }
      });
      blocks.push({ type: 'divider' });
    }
  }

  return blocks;
}

function formatChallengeResponse(results) {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '⚔️ Challenge Panel' }
    },
    { type: 'divider' }
  ];

  const providers = ['claude', 'gpt', 'gemini'];
  const names = { claude: 'Claude', gpt: 'GPT-4o', gemini: 'Gemini' };

  for (const provider of providers) {
    const result = results[provider];
    if (result.success) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${names[provider]} challenges:*\n${result.response.substring(0, 800)}`
        }
      });
      blocks.push({ type: 'divider' });
    }
  }

  return blocks;
}

// ============================================================================
// EXPRESS MIDDLEWARE FOR SLACK EVENTS
// ============================================================================

export function getSlackReceiver() {
  if (!slackApp) return null;
  return slackApp.receiver;
}

export { slackApp };
