/**
 * ENHANCED RAG SYSTEM
 *
 * Advanced Retrieval-Augmented Generation with:
 * - Structured retrieval patterns
 * - Query decomposition
 * - Multi-source fusion
 * - Relevance re-ranking
 * - Context window optimization
 */

import * as db from '../db/index.js';
import * as vectorDb from './vector-db.js';
import * as aiProviders from './ai-providers.js';

// ============================================================================
// QUERY DECOMPOSITION
// ============================================================================

/**
 * Decompose complex query into sub-queries for better retrieval
 */
export async function decomposeQuery(query) {
  const prompt = `Decompose this query into 2-4 specific sub-queries for knowledge retrieval.
Return JSON array of strings only.

Query: "${query}"

Example output: ["sub-query 1", "sub-query 2"]`;

  try {
    const result = await aiProviders.fastChat(prompt);
    const parsed = JSON.parse(result.response.match(/\[[\s\S]*\]/)?.[0] || '[]');
    return parsed.length > 0 ? parsed : [query];
  } catch (e) {
    return [query]; // Fallback to original
  }
}

// ============================================================================
// MULTI-SOURCE RETRIEVAL
// ============================================================================

/**
 * Retrieve from multiple sources in parallel
 */
export async function multiSourceRetrieve(query, options = {}) {
  const {
    sources = ['pinecone', 'memory', 'github'],
    topK = 5,
    minScore = 0.5
  } = options;

  const results = {
    query,
    sources: {},
    combined: [],
    metadata: { retrievedAt: new Date().toISOString() }
  };

  const promises = [];

  // Pinecone/Vector DB
  if (sources.includes('pinecone')) {
    promises.push(
      vectorDb.search(query, topK)
        .then(r => ({ source: 'pinecone', results: r || [] }))
        .catch(() => ({ source: 'pinecone', results: [] }))
    );
  }

  // Database memory
  if (sources.includes('memory')) {
    promises.push(
      db.getMemoryByCategory('knowledge')
        .then(r => {
          const matches = Object.entries(r || {})
            .filter(([k]) => k.toLowerCase().includes(query.toLowerCase().split(' ')[0]))
            .map(([key, value]) => ({ key, value, score: 0.7 }));
          return { source: 'memory', results: matches };
        })
        .catch(() => ({ source: 'memory', results: [] }))
    );
  }

  // Recent conversations
  if (sources.includes('conversations')) {
    promises.push(
      searchConversations(query, topK)
        .then(r => ({ source: 'conversations', results: r }))
        .catch(() => ({ source: 'conversations', results: [] }))
    );
  }

  const sourceResults = await Promise.all(promises);

  // Organize by source
  for (const { source, results: items } of sourceResults) {
    results.sources[source] = items;
    results.combined.push(...items.map(item => ({ ...item, source })));
  }

  // Sort by score and filter
  results.combined = results.combined
    .filter(r => (r.score || 0.6) >= minScore)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, topK * 2);

  return results;
}

/**
 * Search conversation history
 */
async function searchConversations(query, limit = 5) {
  try {
    const result = await db.query(`
      SELECT content, role, session_id, created_at
      FROM conversations
      WHERE content ILIKE $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [`%${query.split(' ').slice(0, 3).join('%')}%`, limit]);

    return result.rows.map(r => ({
      content: r.content,
      role: r.role,
      score: 0.6,
      timestamp: r.created_at
    }));
  } catch (e) {
    return [];
  }
}

// ============================================================================
// RELEVANCE RE-RANKING
// ============================================================================

/**
 * Re-rank retrieved results using AI
 */
export async function rerank(query, documents, topN = 5) {
  if (documents.length <= topN) return documents;

  const prompt = `Given this query and documents, return the indices of the ${topN} most relevant documents in order of relevance.

Query: "${query}"

Documents:
${documents.map((d, i) => `[${i}] ${(d.content || d.text || JSON.stringify(d)).substring(0, 200)}`).join('\n')}

Return JSON array of indices only, e.g., [2, 0, 4, 1, 3]`;

  try {
    const result = await aiProviders.fastChat(prompt);
    const indices = JSON.parse(result.response.match(/\[[\d,\s]+\]/)?.[0] || '[]');
    return indices.slice(0, topN).map(i => documents[i]).filter(Boolean);
  } catch (e) {
    return documents.slice(0, topN);
  }
}

// ============================================================================
// CONTEXT WINDOW OPTIMIZATION
// ============================================================================

/**
 * Optimize context to fit within token limits
 */
export function optimizeContext(documents, maxTokens = 4000) {
  const estimateTokens = (text) => Math.ceil(text.length / 4);

  let totalTokens = 0;
  const selected = [];

  // Sort by score
  const sorted = [...documents].sort((a, b) => (b.score || 0) - (a.score || 0));

  for (const doc of sorted) {
    const content = doc.content || doc.text || JSON.stringify(doc);
    const tokens = estimateTokens(content);

    if (totalTokens + tokens <= maxTokens) {
      selected.push(doc);
      totalTokens += tokens;
    } else if (totalTokens < maxTokens * 0.8) {
      // Truncate last document to fit
      const remaining = maxTokens - totalTokens;
      const truncated = content.substring(0, remaining * 4);
      selected.push({ ...doc, content: truncated, truncated: true });
      break;
    }
  }

  return {
    documents: selected,
    totalTokens,
    documentsIncluded: selected.length,
    documentsDropped: documents.length - selected.length
  };
}

// ============================================================================
// ENHANCED RAG PIPELINE
// ============================================================================

/**
 * Full RAG pipeline with all enhancements
 */
export async function enhancedRAG(query, options = {}) {
  const {
    decompose = true,
    rerank: doRerank = true,
    maxTokens = 4000,
    topK = 10,
    sources = ['pinecone', 'memory']
  } = options;

  const pipeline = {
    query,
    steps: [],
    startTime: Date.now()
  };

  // Step 1: Query decomposition
  let queries = [query];
  if (decompose) {
    queries = await decomposeQuery(query);
    pipeline.steps.push({ step: 'decompose', queries });
  }

  // Step 2: Multi-source retrieval
  const allResults = [];
  for (const q of queries) {
    const results = await multiSourceRetrieve(q, { sources, topK });
    allResults.push(...results.combined);
  }
  pipeline.steps.push({ step: 'retrieve', count: allResults.length });

  // Step 3: Deduplicate
  const unique = deduplicateResults(allResults);
  pipeline.steps.push({ step: 'deduplicate', count: unique.length });

  // Step 4: Re-rank
  let ranked = unique;
  if (doRerank && unique.length > 5) {
    ranked = await rerank(query, unique, Math.min(topK, 10));
    pipeline.steps.push({ step: 'rerank', count: ranked.length });
  }

  // Step 5: Context optimization
  const optimized = optimizeContext(ranked, maxTokens);
  pipeline.steps.push({ step: 'optimize', ...optimized });

  // Build final context
  const context = buildContextString(optimized.documents);

  pipeline.context = context;
  pipeline.documents = optimized.documents;
  pipeline.latencyMs = Date.now() - pipeline.startTime;

  return pipeline;
}

/**
 * Deduplicate results by content similarity
 */
function deduplicateResults(results) {
  const seen = new Set();
  return results.filter(r => {
    const key = (r.content || r.text || '').substring(0, 100);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Build context string from documents
 */
function buildContextString(documents) {
  return documents.map((doc, i) => {
    const content = doc.content || doc.text || JSON.stringify(doc);
    const source = doc.source || 'unknown';
    return `[Source ${i + 1}: ${source}]\n${content}`;
  }).join('\n\n---\n\n');
}

// ============================================================================
// RAG-AUGMENTED QUERY
// ============================================================================

/**
 * Answer query using RAG-augmented context
 */
export async function ragQuery(query, options = {}) {
  const { model = 'claude' } = options;

  // Get enhanced context
  const rag = await enhancedRAG(query, options);

  // Build prompt with context
  const prompt = `Use the following context to answer the question. If the context doesn't contain relevant information, say so.

CONTEXT:
${rag.context || 'No relevant context found.'}

QUESTION: ${query}

Provide a comprehensive answer based on the context above.`;

  // Query AI with context
  const response = await aiProviders.chat(model, prompt);

  return {
    query,
    answer: response.response,
    context: rag.context,
    sources: rag.documents.map(d => d.source),
    pipeline: rag.steps,
    latencyMs: rag.latencyMs + (response.latencyMs || 0)
  };
}

export default {
  decomposeQuery,
  multiSourceRetrieve,
  rerank,
  optimizeContext,
  enhancedRAG,
  ragQuery
};
