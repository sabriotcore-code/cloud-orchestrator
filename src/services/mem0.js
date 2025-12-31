// ============================================================================
// MEM0 LONG-TERM MEMORY SERVICE
// Persistent semantic memory across conversations and sessions
// ============================================================================

import fetch from 'node-fetch';

const MEM0_API_URL = 'https://api.mem0.ai/v1';
let apiKey = null;
let orgId = null;
let projectId = null;

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initMem0() {
  apiKey = process.env.MEM0_API_KEY;
  orgId = process.env.MEM0_ORG_ID;
  projectId = process.env.MEM0_PROJECT_ID;

  if (!apiKey) {
    console.log('[Mem0] Not configured - MEM0_API_KEY required');
    return false;
  }

  console.log('[Mem0] Long-term memory ready');
  return true;
}

// ============================================================================
// MEMORY OPERATIONS
// ============================================================================

/**
 * Add a memory for a user
 */
export async function addMemory(userId, content, metadata = {}) {
  if (!apiKey) initMem0();
  if (!apiKey) throw new Error('Mem0 not configured');

  const body = {
    messages: [{ role: 'user', content }],
    user_id: userId,
    metadata
  };

  // Add org/project IDs if configured
  if (orgId) body.org_id = orgId;
  if (projectId) body.project_id = projectId;

  console.log('[Mem0] Adding memory for user:', userId, 'org:', orgId, 'project:', projectId);
  console.log('[Mem0] Request body:', JSON.stringify(body));

  const response = await fetch(`${MEM0_API_URL}/memories/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Token ${apiKey}`,
      'x-org-id': orgId || '',
      'x-project-id': projectId || ''
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to add memory: ${error}`);
  }

  return response.json();
}

/**
 * Search memories for a user
 */
export async function searchMemories(userId, query, options = {}) {
  if (!apiKey) initMem0();
  if (!apiKey) throw new Error('Mem0 not configured');

  const { limit = 10, threshold = 0.7 } = options;

  const body = {
    query,
    user_id: userId,
    limit,
    threshold
  };

  if (orgId) body.org_id = orgId;
  if (projectId) body.project_id = projectId;

  console.log('[Mem0] Searching memories for user:', userId, 'query:', query);

  const response = await fetch(`${MEM0_API_URL}/memories/search/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Token ${apiKey}`,
      'x-org-id': orgId || '',
      'x-project-id': projectId || ''
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Memory search failed: ${error}`);
  }

  return response.json();
}

/**
 * Get all memories for a user
 */
export async function getMemories(userId, options = {}) {
  if (!apiKey) initMem0();
  if (!apiKey) throw new Error('Mem0 not configured');

  const { limit = 100, page = 1 } = options;

  const params = new URLSearchParams({
    user_id: userId,
    limit: limit.toString(),
    page: page.toString()
  });

  if (orgId) params.append('org_id', orgId);
  if (projectId) params.append('project_id', projectId);

  console.log('[Mem0] Getting memories for user:', userId);

  const response = await fetch(`${MEM0_API_URL}/memories/?${params}`, {
    headers: {
      'Authorization': `Token ${apiKey}`,
      'x-org-id': orgId || '',
      'x-project-id': projectId || ''
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get memories: ${error}`);
  }

  return response.json();
}

/**
 * Get a specific memory by ID
 */
export async function getMemory(memoryId) {
  if (!apiKey) initMem0();
  if (!apiKey) throw new Error('Mem0 not configured');

  const response = await fetch(`${MEM0_API_URL}/memories/${memoryId}`, {
    headers: { 'Authorization': `Token ${apiKey}` }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get memory: ${error}`);
  }

  return response.json();
}

/**
 * Update a memory
 */
export async function updateMemory(memoryId, content) {
  if (!apiKey) initMem0();
  if (!apiKey) throw new Error('Mem0 not configured');

  const response = await fetch(`${MEM0_API_URL}/memories/${memoryId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Token ${apiKey}`
    },
    body: JSON.stringify({ text: content })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update memory: ${error}`);
  }

  return response.json();
}

/**
 * Delete a memory
 */
export async function deleteMemory(memoryId) {
  if (!apiKey) initMem0();
  if (!apiKey) throw new Error('Mem0 not configured');

  const response = await fetch(`${MEM0_API_URL}/memories/${memoryId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Token ${apiKey}` }
  });

  return response.ok;
}

/**
 * Delete all memories for a user
 */
export async function deleteAllMemories(userId) {
  if (!apiKey) initMem0();
  if (!apiKey) throw new Error('Mem0 not configured');

  const params = new URLSearchParams({ user_id: userId });
  if (orgId) params.append('org_id', orgId);
  if (projectId) params.append('project_id', projectId);

  const response = await fetch(`${MEM0_API_URL}/memories?${params}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Token ${apiKey}` }
  });

  return response.ok;
}

// ============================================================================
// CONVERSATION MEMORY
// ============================================================================

/**
 * Store a full conversation exchange
 */
export async function storeConversation(userId, messages, metadata = {}) {
  if (!apiKey) initMem0();
  if (!apiKey) throw new Error('Mem0 not configured');

  const response = await fetch(`${MEM0_API_URL}/memories`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Token ${apiKey}`
    },
    body: JSON.stringify({
      messages,
      user_id: userId,
      metadata: {
        ...metadata,
        type: 'conversation',
        timestamp: new Date().toISOString()
      },
      org_id: orgId,
      project_id: projectId
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to store conversation: ${error}`);
  }

  return response.json();
}

/**
 * Get relevant context for a new message
 */
export async function getContext(userId, message, options = {}) {
  const { limit = 5, includeRecent = true, recentLimit = 3 } = options;

  const results = {
    relevant: [],
    recent: []
  };

  // Search for relevant memories
  try {
    const searchResult = await searchMemories(userId, message, { limit });
    results.relevant = searchResult.memories || searchResult || [];
  } catch (e) {
    console.error('[Mem0] Search failed:', e.message);
  }

  // Get recent memories if requested
  if (includeRecent) {
    try {
      const recentResult = await getMemories(userId, { limit: recentLimit });
      results.recent = (recentResult.memories || recentResult || [])
        .filter(m => !results.relevant.find(r => r.id === m.id));
    } catch (e) {
      console.error('[Mem0] Get recent failed:', e.message);
    }
  }

  return results;
}

// ============================================================================
// PREFERENCE LEARNING
// ============================================================================

/**
 * Store a user preference
 */
export async function storePreference(userId, category, preference, value) {
  return addMemory(userId, `User preference: ${preference} = ${value}`, {
    type: 'preference',
    category,
    preference,
    value
  });
}

/**
 * Get user preferences
 */
export async function getPreferences(userId, category = null) {
  const memories = await getMemories(userId, { limit: 100 });
  const allMemories = memories.memories || memories || [];

  return allMemories.filter(m =>
    m.metadata?.type === 'preference' &&
    (!category || m.metadata?.category === category)
  );
}

/**
 * Learn from user feedback
 */
export async function learnFromFeedback(userId, context, feedback, outcome) {
  return addMemory(userId,
    `Feedback on "${context}": ${feedback}. Outcome: ${outcome}`,
    {
      type: 'feedback',
      context,
      feedback,
      outcome,
      learnedAt: new Date().toISOString()
    }
  );
}

// ============================================================================
// FACTS AND KNOWLEDGE
// ============================================================================

/**
 * Store a fact about the user/context
 */
export async function storeFact(userId, fact, source = 'conversation', confidence = 1.0) {
  return addMemory(userId, fact, {
    type: 'fact',
    source,
    confidence,
    learnedAt: new Date().toISOString()
  });
}

/**
 * Search for facts
 */
export async function searchFacts(userId, query) {
  const results = await searchMemories(userId, query, { limit: 10 });
  const memories = results.memories || results || [];

  return memories.filter(m => m.metadata?.type === 'fact');
}

/**
 * Store a decision and its reasoning
 */
export async function storeDecision(userId, decision, reasoning, outcome = null) {
  return addMemory(userId,
    `Decision: ${decision}. Reasoning: ${reasoning}${outcome ? `. Outcome: ${outcome}` : ''}`,
    {
      type: 'decision',
      decision,
      reasoning,
      outcome,
      decidedAt: new Date().toISOString()
    }
  );
}

// ============================================================================
// ENTITY MEMORY
// ============================================================================

/**
 * Store information about an entity (person, company, property, etc.)
 */
export async function storeEntityInfo(userId, entityType, entityId, info) {
  return addMemory(userId,
    `${entityType} ${entityId}: ${info}`,
    {
      type: 'entity',
      entityType,
      entityId,
      info
    }
  );
}

/**
 * Get all info about an entity
 */
export async function getEntityInfo(userId, entityType, entityId) {
  const results = await searchMemories(userId, `${entityType} ${entityId}`, { limit: 20 });
  const memories = results.memories || results || [];

  return memories.filter(m =>
    m.metadata?.entityType === entityType &&
    m.metadata?.entityId === entityId
  );
}

// ============================================================================
// AGENT/SESSION MEMORY
// ============================================================================

/**
 * Store memory for an AI agent
 */
export async function storeAgentMemory(agentId, content, metadata = {}) {
  return addMemory(`agent_${agentId}`, content, {
    ...metadata,
    type: 'agent_memory'
  });
}

/**
 * Get agent context
 */
export async function getAgentContext(agentId, query) {
  return getContext(`agent_${agentId}`, query);
}

/**
 * Store session summary
 */
export async function storeSessionSummary(userId, sessionId, summary, highlights = []) {
  return addMemory(userId, summary, {
    type: 'session_summary',
    sessionId,
    highlights,
    endedAt: new Date().toISOString()
  });
}

// ============================================================================
// MEMORY HISTORY
// ============================================================================

/**
 * Get memory history for a specific memory
 */
export async function getMemoryHistory(memoryId) {
  if (!apiKey) initMem0();
  if (!apiKey) throw new Error('Mem0 not configured');

  const response = await fetch(`${MEM0_API_URL}/memories/${memoryId}/history`, {
    headers: { 'Authorization': `Token ${apiKey}` }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get memory history: ${error}`);
  }

  return response.json();
}

// ============================================================================
// BULK OPERATIONS
// ============================================================================

/**
 * Import multiple memories
 */
export async function importMemories(userId, memories) {
  const results = [];

  for (const memory of memories) {
    try {
      const result = await addMemory(userId, memory.content, memory.metadata || {});
      results.push({ success: true, memory: result });
    } catch (error) {
      results.push({ success: false, error: error.message, content: memory.content });
    }
  }

  return results;
}

/**
 * Export all memories for a user
 */
export async function exportMemories(userId) {
  const allMemories = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const result = await getMemories(userId, { limit: 100, page });
    const memories = result.memories || result || [];

    if (memories.length === 0) {
      hasMore = false;
    } else {
      allMemories.push(...memories);
      page++;
    }
  }

  return allMemories;
}

// ============================================================================
// STATUS
// ============================================================================

export function getMem0Status() {
  return {
    configured: !!apiKey || !!process.env.MEM0_API_KEY,
    ready: !!apiKey,
    hasOrg: !!orgId,
    hasProject: !!projectId
  };
}

export default {
  initMem0,
  addMemory,
  searchMemories,
  getMemories,
  getMemory,
  updateMemory,
  deleteMemory,
  deleteAllMemories,
  storeConversation,
  getContext,
  storePreference,
  getPreferences,
  learnFromFeedback,
  storeFact,
  searchFacts,
  storeDecision,
  storeEntityInfo,
  getEntityInfo,
  storeAgentMemory,
  getAgentContext,
  storeSessionSummary,
  getMemoryHistory,
  importMemories,
  exportMemories,
  getMem0Status
};
