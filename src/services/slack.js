import pkg from '@slack/bolt';
const { App } = pkg;
import * as ai from './ai.js';
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
    const status = Object.values(providers).every(v => v) ? '✅ All systems operational' : '⚠️ Some providers unavailable';

    const text = `*🏥 System Health:*\n${status}\n\n` +
      `• Claude: ${providers.claude ? '✅' : '❌'}\n` +
      `• GPT-4o: ${providers.gpt ? '✅' : '❌'}\n` +
      `• Gemini: ${providers.gemini ? '✅' : '❌'}`;

    await respond({ text, response_type: 'ephemeral' });
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
