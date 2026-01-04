// ============================================================================
// MEMGPT SERVICE - Hierarchical Self-Managing Memory
// Working Memory + Core Memory + Archival Memory with self-editing
// ============================================================================

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { pineconeUpsert, pineconeQuery } from './vector-db.js';
import { cacheSet, cacheGet, cacheDelete } from './vector-db.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ============================================================================
// MEMORY STORES
// ============================================================================

// Core Memory: Key facts that are always available (small, fast)
const coreMemory = {
  user: {
    name: 'Matt Lamb',
    role: 'Real estate investor',
    properties: 185,
    location: 'Arkansas',
    preferences: {
      style: 'direct, no fluff',
      emojis: false,
      autoApprove: true
    }
  },
  system: {
    name: 'Cloud Orchestrator',
    version: '4.0',
    capabilities: []
  },
  facts: new Map(),
  relationships: new Map()
};

// Working Memory: Active context for current task (limited size)
const workingMemory = {
  items: [],
  maxItems: 50,
  maxTokens: 50000,
  currentTokens: 0
};

// Archival Memory: Long-term storage via Pinecone (unlimited)
const archivalIndex = 'memgpt-archival';

// Conversation Buffer: Recent messages
const conversationBuffer = {
  messages: [],
  maxMessages: 100
};

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    coreMemory: {
      facts: coreMemory.facts.size,
      relationships: coreMemory.relationships.size,
      user: !!coreMemory.user.name
    },
    workingMemory: {
      items: workingMemory.items.length,
      maxItems: workingMemory.maxItems,
      tokenUsage: `${workingMemory.currentTokens}/${workingMemory.maxTokens}`
    },
    conversationBuffer: conversationBuffer.messages.length,
    archival: 'pinecone',
    ready: !!(openai || anthropic)
  };
}

// ============================================================================
// CORE MEMORY (Always Available)
// ============================================================================

/**
 * Add a core fact that should always be remembered
 */
export function addCoreFact(key, value, category = 'general') {
  coreMemory.facts.set(key, {
    value,
    category,
    addedAt: new Date().toISOString(),
    accessCount: 0
  });
  return { success: true, key, stored: 'core' };
}

/**
 * Get a core fact
 */
export function getCoreFact(key) {
  const fact = coreMemory.facts.get(key);
  if (fact) {
    fact.accessCount++;
    fact.lastAccessed = new Date().toISOString();
    return fact.value;
  }
  return null;
}

/**
 * Add a relationship between entities
 */
export function addRelationship(entity1, relation, entity2, metadata = {}) {
  const key = `${entity1}:${relation}:${entity2}`;
  coreMemory.relationships.set(key, {
    entity1,
    relation,
    entity2,
    metadata,
    addedAt: new Date().toISOString()
  });
  return { success: true, relationship: key };
}

/**
 * Query relationships
 */
export function queryRelationships(entity, relation = null) {
  const results = [];
  for (const [key, rel] of coreMemory.relationships) {
    if (rel.entity1 === entity || rel.entity2 === entity) {
      if (!relation || rel.relation === relation) {
        results.push(rel);
      }
    }
  }
  return results;
}

/**
 * Get all core memory for context
 */
export function getCoreMemoryContext() {
  const facts = [];
  for (const [key, fact] of coreMemory.facts) {
    facts.push(`${key}: ${fact.value}`);
  }

  return {
    user: coreMemory.user,
    system: coreMemory.system,
    facts: facts.slice(0, 20),  // Top 20 most relevant
    relationships: Array.from(coreMemory.relationships.values()).slice(0, 10)
  };
}

// ============================================================================
// WORKING MEMORY (Active Context)
// ============================================================================

/**
 * Add item to working memory with relevance score
 */
export function addToWorkingMemory(content, relevance = 0.5, metadata = {}) {
  const tokens = estimateTokens(content);

  const item = {
    id: `wm_${Date.now()}`,
    content,
    relevance,
    metadata,
    tokens,
    addedAt: new Date().toISOString(),
    accessCount: 0
  };

  workingMemory.items.push(item);
  workingMemory.currentTokens += tokens;

  // Garbage collect if over limit
  while (workingMemory.currentTokens > workingMemory.maxTokens ||
         workingMemory.items.length > workingMemory.maxItems) {
    evictLeastRelevant();
  }

  return { success: true, id: item.id, tokens };
}

/**
 * Get working memory contents
 */
export function getWorkingMemory(limit = 20) {
  // Sort by relevance * recency
  const sorted = [...workingMemory.items].sort((a, b) => {
    const scoreA = a.relevance * (1 + a.accessCount * 0.1);
    const scoreB = b.relevance * (1 + b.accessCount * 0.1);
    return scoreB - scoreA;
  });

  return sorted.slice(0, limit).map(item => {
    item.accessCount++;
    return item;
  });
}

/**
 * Search working memory
 */
export function searchWorkingMemory(query) {
  const queryLower = query.toLowerCase();
  return workingMemory.items
    .filter(item => item.content.toLowerCase().includes(queryLower))
    .sort((a, b) => b.relevance - a.relevance);
}

/**
 * Evict least relevant item from working memory
 */
function evictLeastRelevant() {
  if (workingMemory.items.length === 0) return;

  // Find item with lowest score (relevance * access * recency)
  let minIndex = 0;
  let minScore = Infinity;

  workingMemory.items.forEach((item, index) => {
    const age = (Date.now() - new Date(item.addedAt).getTime()) / 1000 / 60; // minutes
    const score = item.relevance * (1 + item.accessCount * 0.1) / (1 + age * 0.01);
    if (score < minScore) {
      minScore = score;
      minIndex = index;
    }
  });

  const evicted = workingMemory.items.splice(minIndex, 1)[0];
  workingMemory.currentTokens -= evicted.tokens;

  // Optionally archive important evicted items
  if (evicted.relevance > 0.7) {
    archiveToLongTerm(evicted.content, evicted.metadata);
  }
}

/**
 * Clear working memory
 */
export function clearWorkingMemory() {
  workingMemory.items = [];
  workingMemory.currentTokens = 0;
  return { success: true, message: 'Working memory cleared' };
}

// ============================================================================
// ARCHIVAL MEMORY (Long-term via Pinecone)
// ============================================================================

/**
 * Archive content to long-term memory
 */
export async function archiveToLongTerm(content, metadata = {}) {
  if (!openai) throw new Error('OpenAI required for embeddings');

  const embedding = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: content.substring(0, 8000)
  });

  const id = `archive_${Date.now()}`;

  await pineconeUpsert(archivalIndex, [{
    id,
    values: embedding.data[0].embedding,
    metadata: {
      content: content.substring(0, 1000),
      fullContent: content,
      ...metadata,
      archivedAt: new Date().toISOString()
    }
  }]);

  return { success: true, id, stored: 'archival' };
}

/**
 * Search archival memory
 */
export async function searchArchival(query, topK = 10) {
  if (!openai) return [];

  const embedding = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query
  });

  const results = await pineconeQuery(archivalIndex, embedding.data[0].embedding, topK);

  return results.map(r => ({
    id: r.id,
    score: r.score,
    content: r.metadata?.fullContent || r.metadata?.content,
    metadata: r.metadata
  }));
}

/**
 * Recall from all memory layers
 */
export async function recall(query, options = {}) {
  const results = {
    core: [],
    working: [],
    archival: [],
    conversation: []
  };

  // 1. Check core memory
  const queryLower = query.toLowerCase();
  for (const [key, fact] of coreMemory.facts) {
    if (key.toLowerCase().includes(queryLower) ||
        fact.value.toLowerCase().includes(queryLower)) {
      results.core.push({ key, value: fact.value, category: fact.category });
    }
  }

  // 2. Check working memory
  results.working = searchWorkingMemory(query);

  // 3. Check conversation buffer
  results.conversation = conversationBuffer.messages
    .filter(m => m.content.toLowerCase().includes(queryLower))
    .slice(-5);

  // 4. Check archival if not found locally
  if (results.core.length + results.working.length < 3) {
    try {
      results.archival = await searchArchival(query, options.topK || 5);
    } catch (e) {
      console.log('[MemGPT] Archival search failed:', e.message);
    }
  }

  return results;
}

// ============================================================================
// CONVERSATION BUFFER
// ============================================================================

/**
 * Add message to conversation buffer
 */
export function addMessage(role, content, metadata = {}) {
  const message = {
    id: `msg_${Date.now()}`,
    role,
    content,
    metadata,
    timestamp: new Date().toISOString()
  };

  conversationBuffer.messages.push(message);

  // Trim if over limit
  while (conversationBuffer.messages.length > conversationBuffer.maxMessages) {
    const old = conversationBuffer.messages.shift();
    // Archive old important messages
    if (old.metadata?.important) {
      archiveToLongTerm(`[${old.role}] ${old.content}`, { type: 'conversation' });
    }
  }

  return message;
}

/**
 * Get recent conversation
 */
export function getRecentConversation(limit = 20) {
  return conversationBuffer.messages.slice(-limit);
}

// ============================================================================
// SELF-EDITING MEMORY (The MemGPT Magic)
// ============================================================================

/**
 * AI decides what to remember/forget
 */
export async function selfManageMemory(context) {
  if (!anthropic) throw new Error('Anthropic required for memory management');

  const currentMemory = {
    core: getCoreMemoryContext(),
    working: getWorkingMemory(10),
    recentConversation: getRecentConversation(5)
  };

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `You are the memory manager for an AI assistant. Analyze the current context and decide what to remember or forget.

CURRENT CONTEXT:
${context}

CURRENT MEMORY STATE:
${JSON.stringify(currentMemory, null, 2)}

Decide:
1. What new facts should be added to CORE memory (always available)?
2. What should be added to WORKING memory (current task)?
3. What should be ARCHIVED (long-term, searchable)?
4. What can be FORGOTTEN (not needed)?

Return JSON:
{
  "addToCore": [{"key": "...", "value": "...", "reason": "..."}],
  "addToWorking": [{"content": "...", "relevance": 0.0-1.0}],
  "archive": [{"content": "...", "reason": "..."}],
  "forget": [{"id": "...", "reason": "..."}],
  "summary": "Brief explanation of memory decisions"
}`
    }]
  });

  try {
    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { error: 'No JSON in response' };

    const decisions = JSON.parse(jsonMatch[0]);

    // Execute memory operations
    for (const fact of decisions.addToCore || []) {
      addCoreFact(fact.key, fact.value);
    }

    for (const item of decisions.addToWorking || []) {
      addToWorkingMemory(item.content, item.relevance);
    }

    for (const item of decisions.archive || []) {
      await archiveToLongTerm(item.content, { reason: item.reason });
    }

    return {
      success: true,
      decisions,
      memoryState: getStatus()
    };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Compress working memory into summary
 */
export async function compressWorkingMemory() {
  if (!anthropic) throw new Error('Anthropic required for compression');

  const items = getWorkingMemory(workingMemory.items.length);
  if (items.length < 10) return { message: 'Not enough items to compress' };

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Summarize these working memory items into a concise summary that preserves key information:

${items.map(i => `- ${i.content}`).join('\n')}

Return a single paragraph summary.`
    }]
  });

  const summary = response.content[0].text;

  // Clear old items and add summary
  clearWorkingMemory();
  addToWorkingMemory(summary, 0.9, { type: 'compressed_summary' });

  return {
    success: true,
    originalItems: items.length,
    summary
  };
}

// ============================================================================
// CONTEXT BUILDING
// ============================================================================

/**
 * Build full context for AI prompt
 */
export async function buildContext(query, maxTokens = 8000) {
  const context = {
    core: getCoreMemoryContext(),
    working: getWorkingMemory(15),
    conversation: getRecentConversation(10),
    archival: []
  };

  // Add archival if space allows
  const currentTokens = estimateTokens(JSON.stringify(context));
  if (currentTokens < maxTokens * 0.7) {
    try {
      context.archival = await searchArchival(query, 5);
    } catch (e) {
      // Skip archival if unavailable
    }
  }

  return context;
}

/**
 * Format context for prompt injection
 */
export function formatContextForPrompt(context) {
  let prompt = '';

  // Core facts about user
  if (context.core?.user) {
    prompt += `USER: ${context.core.user.name} (${context.core.user.role}, ${context.core.user.properties} properties)\n`;
    prompt += `PREFERENCES: ${JSON.stringify(context.core.user.preferences)}\n\n`;
  }

  // Key facts
  if (context.core?.facts?.length > 0) {
    prompt += `KEY FACTS:\n${context.core.facts.join('\n')}\n\n`;
  }

  // Working memory
  if (context.working?.length > 0) {
    prompt += `CURRENT CONTEXT:\n`;
    context.working.forEach(w => {
      prompt += `- ${w.content.substring(0, 200)}\n`;
    });
    prompt += '\n';
  }

  // Recent conversation
  if (context.conversation?.length > 0) {
    prompt += `RECENT CONVERSATION:\n`;
    context.conversation.slice(-5).forEach(m => {
      prompt += `[${m.role}]: ${m.content.substring(0, 150)}\n`;
    });
    prompt += '\n';
  }

  // Archival (long-term)
  if (context.archival?.length > 0) {
    prompt += `RELEVANT LONG-TERM MEMORY:\n`;
    context.archival.forEach(a => {
      prompt += `- ${a.content?.substring(0, 200)}\n`;
    });
  }

  return prompt;
}

// ============================================================================
// UTILITIES
// ============================================================================

function estimateTokens(text) {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Core memory
  addCoreFact,
  getCoreFact,
  addRelationship,
  queryRelationships,
  getCoreMemoryContext,
  // Working memory
  addToWorkingMemory,
  getWorkingMemory,
  searchWorkingMemory,
  clearWorkingMemory,
  // Archival memory
  archiveToLongTerm,
  searchArchival,
  recall,
  // Conversation
  addMessage,
  getRecentConversation,
  // Self-management
  selfManageMemory,
  compressWorkingMemory,
  // Context
  buildContext,
  formatContextForPrompt
};
