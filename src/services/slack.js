import pkg from '@slack/bolt';
const { App } = pkg;
import * as ai from './ai.js';
import * as github from './github.js';
import * as memory from './memory.js';
import * as context from './context.js';
import * as db from '../db/index.js';
import { usernameToId, truncate, splitForSlack } from '../utils/helpers.js';

let slackApp = null;
let handleMasterCommand = null; // Will be set from server.js

// ============================================================================
// INITIALIZE SLACK APP - Now with Socket Mode support
// ============================================================================

export function initSlack(expressApp, masterCommandHandler) {
  if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_SIGNING_SECRET) {
    console.log('[Slack] Missing SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET - Slack disabled');
    return null;
  }

  // Store the master command handler for use in events
  handleMasterCommand = masterCommandHandler;

  const useSocketMode = !!process.env.SLACK_APP_TOKEN;

  const appConfig = {
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  };

  // Use Socket Mode if app token is provided (recommended for real-time)
  if (useSocketMode) {
    appConfig.socketMode = true;
    appConfig.appToken = process.env.SLACK_APP_TOKEN;
    console.log('[Slack] Using Socket Mode for real-time events');
  } else {
    appConfig.socketMode = false;
    console.log('[Slack] Using HTTP mode (add SLACK_APP_TOKEN for Socket Mode)');
  }

  slackApp = new App(appConfig);

  // Register all handlers
  registerCommands();
  registerEvents();
  registerActions();
  registerShortcuts();
  registerAppHome();

  // Start the app if using socket mode
  if (useSocketMode) {
    (async () => {
      await slackApp.start();
      console.log('[Slack] Socket Mode connected');
    })();
  }

  console.log('[Slack] Bot initialized with enhanced features');
  return slackApp;
}

// ============================================================================
// SLASH COMMANDS
// ============================================================================

function registerCommands() {
  // /do - Master command (routes through handleMasterCommand)
  slackApp.command('/do', async ({ command, ack, respond, client }) => {
    await ack();

    const query = command.text.trim();
    const userId = command.user_name;

    if (!query) {
      await respond(getHelpMessage());
      return;
    }

    // Show processing indicator
    await respond({
      text: '🤔 Processing...',
      response_type: 'ephemeral'
    });

    try {
      if (handleMasterCommand) {
        const result = await handleMasterCommand(query, userId);
        const response = formatMasterResponse(result);

        // Check if this needs interactive buttons
        const needsConfirmation = response.includes('Reply "/do yes"') ||
                                   response.includes('review needed');

        if (needsConfirmation) {
          await respond({
            blocks: formatWithButtons(response, userId),
            response_type: 'in_channel'
          });
        } else {
          // Split long responses
          const chunks = splitForSlack(response, 3000);
          for (const chunk of chunks) {
            await respond({ text: chunk, response_type: 'in_channel' });
          }
        }
      } else {
        await respond('❌ Command handler not initialized');
      }
    } catch (error) {
      console.error('[Slack] /do error:', error);
      await respond(`❌ Error: ${error.message}`);
    }
  });

  // /ask - Ask all 3 AIs a question
  slackApp.command('/ask', async ({ command, ack, respond }) => {
    await ack();

    const query = command.text.trim();
    if (!query) {
      await respond('Usage: `/ask <your question>`');
      return;
    }

    await respond({
      text: `🤔 Asking Claude, GPT, and Gemini: "${truncate(query, 50)}"...`,
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
          text: { type: 'mrkdwn', text: `*Question:* ${truncate(query, 200)}` }
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
      await respond('❌ GitHub not configured.');
      return;
    }

    const parts = command.text.trim().split('/');
    if (parts.length !== 2) {
      await respond('Usage: `/commits owner/repo`');
      return;
    }

    const [owner, repo] = parts;
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

  // /history - Show bot change history
  slackApp.command('/history', async ({ command, ack, respond }) => {
    await ack();

    const text = command.text.trim();
    const match = text.match(/^([^\/]+)\/([^\s]+)/);

    if (!match) {
      await respond('Usage: `/history owner/repo`\nExample: `/history sabriotcore-code/rei-dashboard`');
      return;
    }

    const [, owner, repo] = match;
    try {
      const changes = await github.getChangeHistory(owner, repo, 10);
      if (changes.length === 0) {
        await respond({ text: `📜 *No changes recorded for ${owner}/${repo}*`, response_type: 'in_channel' });
        return;
      }

      let response = `📜 *Recent Bot Changes to ${owner}/${repo}:*\n\n`;
      response += github.formatChangeHistory(changes);
      await respond({ text: response, response_type: 'in_channel' });
    } catch (error) {
      await respond(`❌ Error: ${error.message}`);
    }
  });
}

// ============================================================================
// EVENT HANDLERS - Enhanced with @mention and message listening
// ============================================================================

function registerEvents() {
  // Respond to @mentions - Routes through master command
  slackApp.event('app_mention', async ({ event, say, client }) => {
    const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
    const userId = event.user;
    const threadTs = event.thread_ts || event.ts;

    // Get username from user ID
    let userName = userId;
    try {
      const userInfo = await client.users.info({ user: userId });
      userName = userInfo.user?.name || userId;
    } catch (e) {
      console.log('[Slack] Could not get user info:', e.message);
    }

    if (!text) {
      await say({
        text: '👋 Hi! I\'m your AI assistant. Just @ me with a question or use `/do` for commands!',
        thread_ts: threadTs
      });
      return;
    }

    // Show typing indicator
    await say({ text: '🤔 Thinking...', thread_ts: threadTs });

    try {
      if (handleMasterCommand) {
        const result = await handleMasterCommand(text, userName);
        const response = formatMasterResponse(result);

        // Check if needs confirmation buttons
        const needsConfirmation = response.includes('Reply "/do yes"');

        if (needsConfirmation) {
          await client.chat.postMessage({
            channel: event.channel,
            thread_ts: threadTs,
            blocks: formatWithButtons(response, userName)
          });
        } else {
          await say({ text: response, thread_ts: threadTs });
        }
      } else {
        // Fallback to consensus
        const results = await ai.askAll(text, 'general');
        const consensus = await ai.buildConsensus(results, 'weighted');
        await say({ text: `*AI Response:*\n${consensus.response}`, thread_ts: threadTs });
      }
    } catch (error) {
      await say({ text: `❌ Error: ${error.message}`, thread_ts: threadTs });
    }
  });

  // Listen to messages with "AI:" prefix or in DMs
  slackApp.message(async ({ message, say, client }) => {
    // Skip bot messages and edited messages
    if (message.bot_id || message.subtype === 'message_changed') return;

    const text = message.text || '';
    const threadTs = message.thread_ts || message.ts;

    // Check if this is a DM (channel starts with D)
    const isDM = message.channel?.startsWith('D');

    // Respond to DMs or messages starting with "AI:"
    if (isDM || text.startsWith('AI:')) {
      const query = isDM ? text : text.substring(3).trim();

      if (!query) return;

      // Get username
      let userName = message.user;
      try {
        const userInfo = await client.users.info({ user: message.user });
        userName = userInfo.user?.name || message.user;
      } catch (e) {}

      try {
        if (handleMasterCommand) {
          const result = await handleMasterCommand(query, userName);
          const response = formatMasterResponse(result);
          await say({ text: response, thread_ts: threadTs });
        } else {
          const results = await ai.askAll(query, 'general');
          const consensus = await ai.buildConsensus(results, 'weighted');
          await say({ text: consensus.response, thread_ts: threadTs });
        }
      } catch (error) {
        await say({ text: `❌ ${error.message}`, thread_ts: threadTs });
      }
    }
  });

  // Handle reactions - ✅ to confirm, ❌ to cancel
  slackApp.event('reaction_added', async ({ event, client }) => {
    const reaction = event.reaction;
    const userId = event.user;
    const itemTs = event.item?.ts;
    const channel = event.item?.channel;

    // Get username
    let userName = userId;
    try {
      const userInfo = await client.users.info({ user: userId });
      userName = userInfo.user?.name || userId;
    } catch (e) {}

    // Check if this is a confirmation reaction on a bot message
    if (reaction === 'white_check_mark' || reaction === '+1' || reaction === 'thumbsup') {
      // Check if there's a pending plan for this user
      const pendingState = await memory.retrieve(`pending_${usernameToId(userName)}`);

      if (pendingState.value === 'PLAN' && handleMasterCommand) {
        try {
          const result = await handleMasterCommand('yes', userName);
          const response = formatMasterResponse(result);

          await client.chat.postMessage({
            channel: channel,
            thread_ts: itemTs,
            text: response
          });
        } catch (error) {
          await client.chat.postMessage({
            channel: channel,
            thread_ts: itemTs,
            text: `❌ Error executing plan: ${error.message}`
          });
        }
      }
    }

    if (reaction === 'x' || reaction === '-1' || reaction === 'thumbsdown') {
      const pendingState = await memory.retrieve(`pending_${usernameToId(userName)}`);

      if (pendingState.value && handleMasterCommand) {
        await handleMasterCommand('no', userName);
        await client.chat.postMessage({
          channel: channel,
          thread_ts: itemTs,
          text: '❌ Cancelled.'
        });
      }
    }
  });
}

// ============================================================================
// INTERACTIVE ACTIONS - Buttons, Modals, etc.
// ============================================================================

function registerActions() {
  // Confirm button clicked
  slackApp.action('confirm_action', async ({ body, ack, respond, client }) => {
    await ack();

    const userId = body.user?.name || body.user?.id;

    try {
      if (handleMasterCommand) {
        const result = await handleMasterCommand('yes', userId);
        const response = formatMasterResponse(result);
        await respond({ text: response, replace_original: false });
      }
    } catch (error) {
      await respond({ text: `❌ Error: ${error.message}`, replace_original: false });
    }
  });

  // Cancel button clicked
  slackApp.action('cancel_action', async ({ body, ack, respond }) => {
    await ack();

    const userId = body.user?.name || body.user?.id;

    try {
      if (handleMasterCommand) {
        await handleMasterCommand('no', userId);
        await respond({ text: '❌ Cancelled.', replace_original: false });
      }
    } catch (error) {
      await respond({ text: `❌ Error: ${error.message}`, replace_original: false });
    }
  });

  // Show more details button
  slackApp.action('show_more', async ({ body, ack, respond }) => {
    await ack();

    const userId = body.user?.name || body.user?.id;
    const storedPlan = await memory.retrieve(`plan_${usernameToId(userId)}`);

    if (storedPlan.value) {
      try {
        const plan = JSON.parse(storedPlan.value);
        let details = '*📋 Full Plan Details:*\n\n';

        if (plan.diagnosis) details += `*Diagnosis:* ${plan.diagnosis}\n\n`;
        if (plan.rootCause) details += `*Root Cause:* ${plan.rootCause}\n\n`;

        if (plan.fixes) {
          details += '*Fixes:*\n';
          for (const fix of plan.fixes) {
            details += `• \`${fix.file}\`: ${fix.description}\n`;
            if (fix.oldCode) details += `  Old: \`${truncate(fix.oldCode, 50)}\`\n`;
            if (fix.newCode) details += `  New: \`${truncate(fix.newCode, 50)}\`\n`;
          }
        }

        await respond({ text: truncate(details, 3000), replace_original: false });
      } catch (e) {
        await respond({ text: '❌ Could not parse plan details.', replace_original: false });
      }
    } else {
      await respond({ text: 'No plan details available.', replace_original: false });
    }
  });

  // Repo selector
  slackApp.action('select_repo', async ({ body, ack, respond }) => {
    await ack();
    const repo = body.actions[0]?.selected_option?.value;
    if (repo) {
      await respond({ text: `Selected: *${repo}*`, replace_original: false });
    }
  });
}

// ============================================================================
// SHORTCUTS - Global and message shortcuts
// ============================================================================

function registerShortcuts() {
  // Global shortcut: Quick ask
  slackApp.shortcut('quick_ask', async ({ shortcut, ack, client }) => {
    await ack();

    await client.views.open({
      trigger_id: shortcut.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'quick_ask_modal',
        title: { type: 'plain_text', text: '🤖 Ask AI' },
        submit: { type: 'plain_text', text: 'Ask' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'input',
            block_id: 'question_block',
            element: {
              type: 'plain_text_input',
              action_id: 'question_input',
              multiline: true,
              placeholder: { type: 'plain_text', text: 'What would you like to know?' }
            },
            label: { type: 'plain_text', text: 'Your Question' }
          }
        ]
      }
    });
  });

  // Message shortcut: Analyze this code
  slackApp.shortcut('analyze_code', async ({ shortcut, ack, client }) => {
    await ack();

    const messageText = shortcut.message?.text || '';

    await client.views.open({
      trigger_id: shortcut.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'analyze_code_modal',
        private_metadata: JSON.stringify({ text: messageText }),
        title: { type: 'plain_text', text: '🔍 Analyze Code' },
        submit: { type: 'plain_text', text: 'Analyze' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Code to analyze:*\n\`\`\`${truncate(messageText, 500)}\`\`\`` }
          },
          {
            type: 'input',
            block_id: 'analysis_type',
            element: {
              type: 'static_select',
              action_id: 'type_select',
              placeholder: { type: 'plain_text', text: 'Select analysis type' },
              options: [
                { text: { type: 'plain_text', text: 'Code Review' }, value: 'review' },
                { text: { type: 'plain_text', text: 'Challenge' }, value: 'challenge' },
                { text: { type: 'plain_text', text: 'Explain' }, value: 'general' }
              ]
            },
            label: { type: 'plain_text', text: 'Analysis Type' }
          }
        ]
      }
    });
  });

  // Handle modal submissions
  slackApp.view('quick_ask_modal', async ({ ack, body, view, client }) => {
    await ack();

    const question = view.state.values.question_block.question_input.value;
    const userId = body.user.id;

    try {
      const results = await ai.askAll(question, 'general');
      const consensus = await ai.buildConsensus(results, 'weighted');

      await client.chat.postMessage({
        channel: userId,
        text: `*Your question:* ${question}\n\n*AI Response:*\n${consensus.response}`
      });
    } catch (error) {
      await client.chat.postMessage({
        channel: userId,
        text: `❌ Error: ${error.message}`
      });
    }
  });

  slackApp.view('analyze_code_modal', async ({ ack, body, view, client }) => {
    await ack();

    const metadata = JSON.parse(view.private_metadata || '{}');
    const code = metadata.text;
    const analysisType = view.state.values.analysis_type.type_select.selected_option.value;
    const userId = body.user.id;

    try {
      const results = await ai.askAll(code, analysisType);
      const consensus = await ai.buildConsensus(results, 'weighted');

      await client.chat.postMessage({
        channel: userId,
        text: `*Code Analysis (${analysisType}):*\n\n${consensus.response}`
      });
    } catch (error) {
      await client.chat.postMessage({
        channel: userId,
        text: `❌ Error: ${error.message}`
      });
    }
  });
}

// ============================================================================
// APP HOME TAB - Dashboard
// ============================================================================

function registerAppHome() {
  slackApp.event('app_home_opened', async ({ event, client }) => {
    const userId = event.user;

    try {
      // Get system status
      const providers = ai.getProviderStatus();
      const githubConnected = github.isConfigured();

      // Get recent activity
      let recentChanges = [];
      try {
        recentChanges = await github.getChangeHistory('sabriotcore-code', 'cloud-orchestrator', 5);
      } catch (e) {}

      // Get usage stats
      let todayUsage = [];
      try {
        todayUsage = await db.getTodayUsage();
      } catch (e) {}

      const totalCost = todayUsage.reduce((sum, r) => sum + parseFloat(r.cost || 0), 0);

      // Build home view
      const blocks = [
        {
          type: 'header',
          text: { type: 'plain_text', text: '🤖 AI Orchestrator Dashboard' }
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: '*Welcome!* I can help you with code reviews, GitHub management, and multi-AI queries.' }
        },
        { type: 'divider' },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: '*🏥 System Status*' }
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Claude:* ${providers.claude ? '✅ Online' : '❌ Offline'}` },
            { type: 'mrkdwn', text: `*GPT-4o:* ${providers.gpt ? '✅ Online' : '❌ Offline'}` },
            { type: 'mrkdwn', text: `*Gemini:* ${providers.gemini ? '✅ Online' : '❌ Offline'}` },
            { type: 'mrkdwn', text: `*GitHub:* ${githubConnected ? '✅ Connected' : '❌ Disconnected'}` }
          ]
        },
        { type: 'divider' },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*💰 Today's Usage:* $${totalCost.toFixed(4)}` }
        },
        { type: 'divider' },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: '*📜 Recent Changes*' }
        }
      ];

      // Add recent changes
      if (recentChanges.length > 0) {
        let changesText = '';
        for (const c of recentChanges.slice(0, 5)) {
          changesText += `• \`${c.action}\` ${c.path} - ${truncate(c.message, 40)}\n`;
        }
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: changesText }
        });
      } else {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: '_No recent changes_' }
        });
      }

      blocks.push({ type: 'divider' });
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '*⚡ Quick Actions*' }
      });
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '📂 My Repos' },
            action_id: 'home_repos'
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '📊 Usage Stats' },
            action_id: 'home_usage'
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❓ Help' },
            action_id: 'home_help'
          }
        ]
      });

      await client.views.publish({
        user_id: userId,
        view: {
          type: 'home',
          blocks
        }
      });
    } catch (error) {
      console.error('[Slack] App Home error:', error);
    }
  });

  // Home button actions
  slackApp.action('home_repos', async ({ body, ack, client }) => {
    await ack();
    try {
      const repos = await github.listRepos(10);
      let text = '*📂 Your Repositories:*\n\n';
      for (const repo of repos) {
        text += `• *${repo.name}* ${repo.isPrivate ? '🔒' : '🌐'}\n`;
      }
      await client.chat.postMessage({
        channel: body.user.id,
        text
      });
    } catch (error) {
      await client.chat.postMessage({
        channel: body.user.id,
        text: `❌ Error: ${error.message}`
      });
    }
  });

  slackApp.action('home_usage', async ({ body, ack, client }) => {
    await ack();
    try {
      const today = await db.getTodayUsage();
      let text = '*📊 Today\'s Usage:*\n\n';
      if (today.length === 0) {
        text += 'No usage recorded today.';
      } else {
        for (const row of today) {
          text += `• ${row.provider}: ${row.calls} calls, $${parseFloat(row.cost).toFixed(4)}\n`;
        }
      }
      await client.chat.postMessage({
        channel: body.user.id,
        text
      });
    } catch (error) {
      await client.chat.postMessage({
        channel: body.user.id,
        text: `❌ Error: ${error.message}`
      });
    }
  });

  slackApp.action('home_help', async ({ body, ack, client }) => {
    await ack();
    await client.chat.postMessage({
      channel: body.user.id,
      text: getHelpMessage()
    });
  });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getHelpMessage() {
  return `🤖 *AI Orchestrator - Commands:*

*💬 Ask AI:*
• \`/ask <question>\` - Ask all 3 AIs
• \`/consensus <question>\` - Get AI consensus
• \`/review <code>\` - Code review panel
• \`/challenge <idea>\` - Challenge your approach

*📂 GitHub:*
• \`/repos\` - List your repositories
• \`/commits owner/repo\` - Recent commits
• \`/history owner/repo\` - Bot change history

*🔧 Master Command:*
• \`/do <anything>\` - Natural language commands
• \`@mention\` me with any request!

*💡 Tips:*
• React with ✅ to confirm plans
• React with ❌ to cancel
• DM me directly for private conversations`;
}

function formatMasterResponse(result) {
  if (result.master?.response) {
    return result.master.response;
  }
  if (result.error) {
    return `❌ ${result.error}`;
  }
  if (result.repos) {
    let text = '*📂 Repositories:*\n';
    for (const repo of result.repos.slice(0, 10)) {
      text += `• ${repo.name}\n`;
    }
    return text;
  }
  return JSON.stringify(result, null, 2);
}

function formatWithButtons(text, userId) {
  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: truncate(text, 2500) }
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Confirm' },
          style: 'primary',
          action_id: 'confirm_action',
          value: userId
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '❌ Cancel' },
          style: 'danger',
          action_id: 'cancel_action',
          value: userId
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '📋 Show Details' },
          action_id: 'show_more',
          value: userId
        }
      ]
    }
  ];
  return blocks;
}

function formatMultiAiResponse(results, query) {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🤖 Multi-AI Response' }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Query:* ${truncate(query, 200)}` }
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
          result.success ? truncate(result.response, 500) : `Error: ${result.error}`
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
          text: `*${names[provider]}:*\n${truncate(result.response, 800)}`
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
          text: `*${names[provider]} challenges:*\n${truncate(result.response, 800)}`
        }
      });
      blocks.push({ type: 'divider' });
    }
  }

  return blocks;
}

// ============================================================================
// PROACTIVE MESSAGING
// ============================================================================

export async function sendNotification(channel, message, options = {}) {
  if (!slackApp) return false;

  try {
    await slackApp.client.chat.postMessage({
      channel,
      text: message,
      ...options
    });
    return true;
  } catch (error) {
    console.error('[Slack] Notification error:', error);
    return false;
  }
}

export async function sendDeployNotification(repo, status, details = '') {
  const channel = process.env.SLACK_NOTIFICATION_CHANNEL || '#general';
  const emoji = status === 'success' ? '🚀' : '❌';
  const message = `${emoji} *Deploy ${status}:* ${repo}\n${details}`;
  return sendNotification(channel, message);
}

// ============================================================================
// EXPORTS
// ============================================================================

export function getSlackReceiver() {
  if (!slackApp) return null;
  return slackApp.receiver;
}

export { slackApp };
