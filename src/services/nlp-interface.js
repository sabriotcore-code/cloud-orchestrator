/**
 * CONVERSATIONAL NLP INTERFACE
 *
 * Natural language system control:
 * - Intent classification
 * - Entity extraction
 * - Slot filling dialogs
 * - Context management
 * - Command generation
 */

import * as db from '../db/index.js';
import * as aiProviders from './ai-providers.js';
import * as sentiment from './sentiment.js';

// ============================================================================
// INTENT CLASSIFICATION
// ============================================================================

const INTENTS = {
  // System commands
  STATUS: { keywords: ['status', 'health', 'how are you', 'working'], action: 'system.status' },
  HELP: { keywords: ['help', 'what can you', 'commands', 'how to'], action: 'system.help' },
  STOP: { keywords: ['stop', 'cancel', 'abort', 'nevermind'], action: 'system.stop' },

  // Data queries
  QUERY: { keywords: ['show', 'get', 'find', 'search', 'list', 'what is'], action: 'data.query' },
  COUNT: { keywords: ['how many', 'count', 'total'], action: 'data.count' },
  COMPARE: { keywords: ['compare', 'difference', 'versus', 'vs'], action: 'data.compare' },

  // Actions
  CREATE: { keywords: ['create', 'add', 'new', 'make'], action: 'action.create' },
  UPDATE: { keywords: ['update', 'change', 'modify', 'edit'], action: 'action.update' },
  DELETE: { keywords: ['delete', 'remove', 'clear'], action: 'action.delete' },
  SEND: { keywords: ['send', 'email', 'message', 'notify'], action: 'action.send' },

  // Analysis
  ANALYZE: { keywords: ['analyze', 'review', 'check', 'examine'], action: 'analysis.run' },
  PREDICT: { keywords: ['predict', 'forecast', 'estimate', 'project'], action: 'analysis.predict' },
  EXPLAIN: { keywords: ['explain', 'why', 'reason', 'cause'], action: 'analysis.explain' },

  // Code/Development
  CODE: { keywords: ['code', 'write', 'implement', 'fix bug'], action: 'code.generate' },
  DEPLOY: { keywords: ['deploy', 'release', 'publish', 'push'], action: 'code.deploy' },
  TEST: { keywords: ['test', 'run tests', 'verify'], action: 'code.test' }
};

/**
 * Classify intent from natural language
 */
export async function classifyIntent(text, options = {}) {
  const { useAI = true, context = {} } = options;

  // Quick rule-based classification
  const ruleResult = ruleBasedClassification(text);

  if (ruleResult.confidence > 0.8) {
    return ruleResult;
  }

  // AI-powered classification for complex cases
  if (useAI) {
    try {
      const aiResult = await aiClassification(text, context);
      return aiResult.confidence > ruleResult.confidence ? aiResult : ruleResult;
    } catch (e) {
      return ruleResult;
    }
  }

  return ruleResult;
}

/**
 * Rule-based intent classification
 */
function ruleBasedClassification(text) {
  const lower = text.toLowerCase();
  let bestMatch = { intent: 'UNKNOWN', action: 'unknown', confidence: 0.3 };

  for (const [intent, config] of Object.entries(INTENTS)) {
    let matchScore = 0;

    for (const keyword of config.keywords) {
      if (lower.includes(keyword)) {
        matchScore += 1 / config.keywords.length;
      }
    }

    if (matchScore > bestMatch.confidence) {
      bestMatch = {
        intent,
        action: config.action,
        confidence: Math.min(0.95, matchScore + 0.5),
        matchedKeywords: config.keywords.filter(k => lower.includes(k))
      };
    }
  }

  return bestMatch;
}

/**
 * AI-powered intent classification
 */
async function aiClassification(text, context) {
  const intents = Object.entries(INTENTS).map(([name, config]) =>
    `${name}: ${config.keywords.slice(0, 3).join(', ')}`
  ).join('\n');

  const prompt = `Classify the user's intent from this message.

Available intents:
${intents}

User message: "${text}"
${context.previousIntent ? `Previous intent: ${context.previousIntent}` : ''}

Return JSON: {"intent": "INTENT_NAME", "confidence": 0.0-1.0, "reason": "brief explanation"}`;

  const response = await aiProviders.fastChat(prompt);
  const parsed = JSON.parse(response.response.match(/\{[\s\S]*\}/)?.[0] || '{}');

  return {
    intent: parsed.intent || 'UNKNOWN',
    action: INTENTS[parsed.intent]?.action || 'unknown',
    confidence: parsed.confidence || 0.5,
    reason: parsed.reason,
    method: 'ai'
  };
}

// ============================================================================
// ENTITY EXTRACTION
// ============================================================================

const ENTITY_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(\+?1[-.]?)?\(?\d{3}\)?[-.]?\d{3}[-.]?\d{4}\b/g,
  date: /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b(today|tomorrow|yesterday|next week|last week)\b/gi,
  time: /\b\d{1,2}:\d{2}\s*(am|pm)?\b/gi,
  money: /\$[\d,]+(\.\d{2})?|\b\d+\s*(dollars?|bucks?)\b/gi,
  percentage: /\b\d+(\.\d+)?%/g,
  number: /\b\d+(\.\d+)?\b/g,
  url: /https?:\/\/[^\s]+/g,
  property: /\b\d+\s+[A-Za-z]+\s+(St|Street|Ave|Avenue|Blvd|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court)\b/gi
};

/**
 * Extract entities from text
 */
export function extractEntities(text) {
  const entities = {};

  for (const [type, pattern] of Object.entries(ENTITY_PATTERNS)) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      entities[type] = [...new Set(matches)]; // Deduplicate
    }
  }

  return entities;
}

/**
 * AI-powered entity extraction
 */
export async function extractEntitiesAI(text, entityTypes = []) {
  const types = entityTypes.length > 0
    ? entityTypes.join(', ')
    : 'person names, organizations, locations, dates, amounts, products, actions';

  const prompt = `Extract named entities from this text.

Text: "${text}"

Extract these entity types: ${types}

Return JSON object with entity types as keys and arrays of found entities as values.
Example: {"person": ["John"], "organization": ["ACME Corp"], "amount": ["$500"]}`;

  try {
    const response = await aiProviders.fastChat(prompt);
    const parsed = JSON.parse(response.response.match(/\{[\s\S]*\}/)?.[0] || '{}');

    // Merge with rule-based extraction
    const ruleEntities = extractEntities(text);

    return {
      ...ruleEntities,
      ...parsed,
      method: 'hybrid'
    };
  } catch (e) {
    return extractEntities(text);
  }
}

// ============================================================================
// SLOT FILLING DIALOGS
// ============================================================================

const activeDialogs = new Map();

/**
 * Define a dialog template
 */
const DIALOG_TEMPLATES = {
  'create-todo': {
    slots: {
      property: { required: true, prompt: 'Which property is this for?' },
      task: { required: true, prompt: 'What needs to be done?' },
      assignee: { required: false, prompt: 'Who should handle this?' },
      dueDate: { required: false, prompt: 'When is it due?' }
    },
    confirmationTemplate: 'Create to-do: "{task}" for {property}. Assigned to {assignee}, due {dueDate}.'
  },
  'send-message': {
    slots: {
      recipient: { required: true, prompt: 'Who should receive this message?' },
      message: { required: true, prompt: 'What should the message say?' },
      channel: { required: false, prompt: 'Send via email, SMS, or Slack?', default: 'email' }
    },
    confirmationTemplate: 'Send {channel} to {recipient}: "{message}"'
  },
  'schedule-event': {
    slots: {
      title: { required: true, prompt: 'What is the event called?' },
      date: { required: true, prompt: 'What date?' },
      time: { required: false, prompt: 'What time?', default: '09:00' },
      attendees: { required: false, prompt: 'Who should attend?' }
    },
    confirmationTemplate: 'Schedule "{title}" on {date} at {time}. Attendees: {attendees}'
  }
};

/**
 * Start a slot-filling dialog
 */
export function startDialog(userId, templateName, initialSlots = {}) {
  const template = DIALOG_TEMPLATES[templateName];
  if (!template) {
    return { error: 'Unknown dialog template' };
  }

  const dialogId = `dialog_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  const dialog = {
    id: dialogId,
    userId,
    template: templateName,
    slots: { ...initialSlots },
    pendingSlot: null,
    status: 'active',
    createdAt: new Date().toISOString()
  };

  // Find first missing required slot
  for (const [slotName, config] of Object.entries(template.slots)) {
    if (config.required && !dialog.slots[slotName]) {
      dialog.pendingSlot = slotName;
      break;
    }
  }

  activeDialogs.set(dialogId, dialog);

  return {
    dialogId,
    status: dialog.pendingSlot ? 'needs_input' : 'ready',
    prompt: dialog.pendingSlot ? template.slots[dialog.pendingSlot].prompt : null,
    currentSlots: dialog.slots
  };
}

/**
 * Continue dialog with user input
 */
export function continueDialog(dialogId, userInput) {
  const dialog = activeDialogs.get(dialogId);
  if (!dialog) {
    return { error: 'Dialog not found' };
  }

  const template = DIALOG_TEMPLATES[dialog.template];

  // Fill pending slot
  if (dialog.pendingSlot) {
    dialog.slots[dialog.pendingSlot] = userInput;
    dialog.pendingSlot = null;
  }

  // Find next missing required slot
  for (const [slotName, config] of Object.entries(template.slots)) {
    if (config.required && !dialog.slots[slotName]) {
      dialog.pendingSlot = slotName;
      break;
    }
  }

  if (dialog.pendingSlot) {
    return {
      dialogId,
      status: 'needs_input',
      prompt: template.slots[dialog.pendingSlot].prompt,
      currentSlots: dialog.slots
    };
  }

  // Apply defaults for optional slots
  for (const [slotName, config] of Object.entries(template.slots)) {
    if (!dialog.slots[slotName] && config.default) {
      dialog.slots[slotName] = config.default;
    }
  }

  // Generate confirmation
  let confirmation = template.confirmationTemplate;
  for (const [key, value] of Object.entries(dialog.slots)) {
    confirmation = confirmation.replace(`{${key}}`, value || 'N/A');
  }

  dialog.status = 'ready';

  return {
    dialogId,
    status: 'ready',
    confirmation,
    slots: dialog.slots
  };
}

/**
 * Complete dialog and get command
 */
export function completeDialog(dialogId) {
  const dialog = activeDialogs.get(dialogId);
  if (!dialog || dialog.status !== 'ready') {
    return { error: 'Dialog not ready or not found' };
  }

  const result = {
    template: dialog.template,
    slots: dialog.slots,
    command: generateCommand(dialog.template, dialog.slots)
  };

  activeDialogs.delete(dialogId);

  return result;
}

/**
 * Generate command from dialog slots
 */
function generateCommand(template, slots) {
  switch (template) {
    case 'create-todo':
      return {
        action: 'queueTodo',
        params: {
          property: slots.property,
          task: slots.task,
          assignee: slots.assignee,
          dueDate: slots.dueDate
        }
      };
    case 'send-message':
      return {
        action: 'sendMessage',
        params: {
          recipient: slots.recipient,
          message: slots.message,
          channel: slots.channel
        }
      };
    case 'schedule-event':
      return {
        action: 'createEvent',
        params: {
          title: slots.title,
          date: slots.date,
          time: slots.time,
          attendees: slots.attendees?.split(',').map(a => a.trim())
        }
      };
    default:
      return { action: 'unknown', params: slots };
  }
}

// ============================================================================
// CONTEXT MANAGEMENT
// ============================================================================

const userContexts = new Map();

/**
 * Get or create user context
 */
export function getUserContext(userId) {
  if (!userContexts.has(userId)) {
    userContexts.set(userId, {
      userId,
      history: [],
      preferences: {},
      lastIntent: null,
      activeTopics: [],
      createdAt: new Date().toISOString()
    });
  }
  return userContexts.get(userId);
}

/**
 * Update user context with new interaction
 */
export function updateContext(userId, interaction) {
  const context = getUserContext(userId);

  context.history.push({
    ...interaction,
    timestamp: new Date().toISOString()
  });

  // Keep last 20 interactions
  if (context.history.length > 20) {
    context.history = context.history.slice(-20);
  }

  if (interaction.intent) {
    context.lastIntent = interaction.intent;
  }

  if (interaction.topics) {
    context.activeTopics = [...new Set([...context.activeTopics, ...interaction.topics])].slice(-5);
  }

  return context;
}

/**
 * Clear user context
 */
export function clearContext(userId) {
  userContexts.delete(userId);
  return { cleared: true };
}

// ============================================================================
// NATURAL LANGUAGE COMMAND PARSER
// ============================================================================

/**
 * Parse natural language into structured command
 */
export async function parseCommand(text, userId = 'default') {
  const context = getUserContext(userId);

  // Classify intent
  const intent = await classifyIntent(text, {
    context: { previousIntent: context.lastIntent }
  });

  // Extract entities
  const entities = await extractEntitiesAI(text);

  // Analyze sentiment for priority inference
  const sentimentResult = await sentiment.analyzeSentiment(text);

  // Build structured command
  const command = {
    raw: text,
    intent: intent.intent,
    action: intent.action,
    entities,
    priority: sentimentResult.urgency === 'critical' ? 'high'
      : sentimentResult.urgency === 'high' ? 'medium'
        : 'normal',
    sentiment: sentimentResult.sentiment,
    confidence: intent.confidence,
    context: {
      previousIntent: context.lastIntent,
      activeTopics: context.activeTopics
    }
  };

  // Update context
  updateContext(userId, {
    text,
    intent: intent.intent,
    entities: Object.keys(entities)
  });

  return command;
}

/**
 * Generate natural language response
 */
export async function generateResponse(command, result) {
  const prompt = `Generate a natural, conversational response for this command result.

Command: ${command.action}
Result: ${JSON.stringify(result).substring(0, 500)}
User sentiment: ${command.sentiment}

Keep response concise (1-2 sentences). Match formality to user's tone.`;

  try {
    const response = await aiProviders.fastChat(prompt);
    return response.response;
  } catch (e) {
    // Fallback response
    if (result.error) {
      return `Sorry, there was an issue: ${result.error}`;
    }
    return `Done! ${command.action} completed successfully.`;
  }
}

// ============================================================================
// SCHEMA FOR NLP DATA
// ============================================================================

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS nlp_interactions (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100),
        raw_text TEXT,
        intent VARCHAR(50),
        entities JSONB,
        command JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await db.query(`CREATE INDEX IF NOT EXISTS idx_nlp_user ON nlp_interactions(user_id, created_at DESC)`);
    schemaReady = true;
  } catch (e) {
    console.error('[NLP] Schema error:', e.message);
  }
}

/**
 * Log interaction for learning
 */
export async function logInteraction(userId, text, intent, entities, command) {
  await ensureSchema();

  await db.query(`
    INSERT INTO nlp_interactions (user_id, raw_text, intent, entities, command)
    VALUES ($1, $2, $3, $4, $5)
  `, [userId, text, intent, JSON.stringify(entities), JSON.stringify(command)]);
}

/**
 * Get user interaction history
 */
export async function getInteractionHistory(userId, limit = 20) {
  await ensureSchema();

  const result = await db.query(`
    SELECT raw_text, intent, created_at
    FROM nlp_interactions
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `, [userId, limit]);

  return result.rows;
}

export default {
  // Intent
  classifyIntent,

  // Entities
  extractEntities,
  extractEntitiesAI,

  // Dialogs
  startDialog,
  continueDialog,
  completeDialog,

  // Context
  getUserContext,
  updateContext,
  clearContext,

  // Command parsing
  parseCommand,
  generateResponse,

  // History
  logInteraction,
  getInteractionHistory
};
