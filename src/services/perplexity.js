// ============================================================================
// PERPLEXITY SERVICE - Real-Time Web Grounding
// Web search with citations for factual grounding
// ============================================================================

import OpenAI from 'openai';

// ============================================================================
// CONFIGURATION
// ============================================================================

const perplexity = process.env.PERPLEXITY_API_KEY
  ? new OpenAI({
      apiKey: process.env.PERPLEXITY_API_KEY,
      baseURL: 'https://api.perplexity.ai'
    })
  : null;

// Fallback to regular OpenAI for web simulation
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Search history
const searchHistory = [];

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    perplexityConfigured: !!perplexity,
    fallbackAvailable: !!openai,
    realtimeSearch: !!perplexity,
    citations: !!perplexity,
    recencyFilters: true,
    searchCount: searchHistory.length,
    ready: !!(perplexity || openai)
  };
}

// ============================================================================
// CORE SEARCH FUNCTIONS
// ============================================================================

/**
 * Search the web with Perplexity for grounded, cited answers
 * @param {string} query - The search query
 * @param {object} options - Search options
 */
export async function search(query, options = {}) {
  const {
    recencyFilter = 'month',  // 'day', 'week', 'month', 'year', 'none'
    returnCitations = true,
    maxTokens = 2048,
    temperature = 0.2,
    systemPrompt = null
  } = options;

  const startTime = Date.now();

  if (perplexity) {
    return searchWithPerplexity(query, {
      recencyFilter,
      returnCitations,
      maxTokens,
      temperature,
      systemPrompt,
      startTime
    });
  }

  // Fallback to simulated search with OpenAI
  return searchWithFallback(query, { maxTokens, temperature, startTime });
}

/**
 * Search using Perplexity API
 */
async function searchWithPerplexity(query, options) {
  const {
    recencyFilter,
    returnCitations,
    maxTokens,
    temperature,
    systemPrompt,
    startTime
  } = options;

  const messages = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  messages.push({ role: 'user', content: query });

  try {
    const response = await perplexity.chat.completions.create({
      model: 'llama-3.1-sonar-large-128k-online',
      messages,
      max_tokens: maxTokens,
      temperature,
      search_recency_filter: recencyFilter !== 'none' ? recencyFilter : undefined,
      return_citations: returnCitations
    });

    const result = {
      query,
      answer: response.choices[0].message.content,
      citations: response.citations || [],
      model: response.model,
      provider: 'perplexity',
      grounded: true,
      recencyFilter,
      timeMs: Date.now() - startTime,
      timestamp: new Date().toISOString()
    };

    // Store in history
    searchHistory.push(result);
    if (searchHistory.length > 200) searchHistory.shift();

    return result;

  } catch (error) {
    // Try fallback if Perplexity fails
    if (openai) {
      return searchWithFallback(query, { maxTokens: options.maxTokens, temperature: options.temperature, startTime });
    }
    throw error;
  }
}

/**
 * Fallback search using OpenAI (simulated web search)
 */
async function searchWithFallback(query, options) {
  const { maxTokens, temperature, startTime } = options;

  if (!openai) throw new Error('No search provider available');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a research assistant. Answer the user's question with factual, well-sourced information.
Include relevant details and context. When possible, mention where this information could be verified.
Note: This is based on training data, not real-time web search.`
      },
      { role: 'user', content: query }
    ],
    max_tokens: maxTokens,
    temperature
  });

  const result = {
    query,
    answer: response.choices[0].message.content,
    citations: [],
    model: response.model,
    provider: 'openai_fallback',
    grounded: false,
    warning: 'Using fallback - not real-time web data',
    timeMs: Date.now() - startTime,
    timestamp: new Date().toISOString()
  };

  searchHistory.push(result);
  if (searchHistory.length > 200) searchHistory.shift();

  return result;
}

// ============================================================================
// SPECIALIZED SEARCH MODES
// ============================================================================

/**
 * Search for current news and events
 */
export async function searchNews(topic, options = {}) {
  const query = `Latest news and developments about: ${topic}.
Include recent events, announcements, and updates from the past week.`;

  return search(query, {
    recencyFilter: options.recency || 'week',
    systemPrompt: 'You are a news researcher. Focus on factual, recent news. Include dates when events occurred.',
    ...options
  });
}

/**
 * Search for factual information with verification
 */
export async function searchFact(claim, options = {}) {
  const query = `Verify this claim with factual information: "${claim}"
Is this accurate? Provide evidence and sources.`;

  const result = await search(query, {
    recencyFilter: 'month',
    systemPrompt: 'You are a fact-checker. Verify claims with evidence. Be explicit about confidence level and sources.',
    ...options
  });

  // Add verification assessment
  result.claimVerification = assessVerification(result.answer, claim);

  return result;
}

/**
 * Search for technical documentation
 */
export async function searchDocs(technology, question, options = {}) {
  const query = `${technology} documentation: ${question}
Provide accurate technical information with code examples if relevant.`;

  return search(query, {
    recencyFilter: 'month',
    systemPrompt: 'You are a technical documentation expert. Provide accurate, up-to-date technical information with examples.',
    ...options
  });
}

/**
 * Search for research and academic information
 */
export async function searchResearch(topic, options = {}) {
  const query = `Academic and research information about: ${topic}
Include recent studies, findings, and expert perspectives.`;

  return search(query, {
    recencyFilter: options.recency || 'year',
    systemPrompt: 'You are an academic researcher. Focus on peer-reviewed research, studies, and expert analysis.',
    ...options
  });
}

/**
 * Search for how-to and tutorial information
 */
export async function searchHowTo(task, options = {}) {
  const query = `How to: ${task}
Provide step-by-step instructions with best practices.`;

  return search(query, {
    recencyFilter: 'month',
    systemPrompt: 'You are an expert instructor. Provide clear, actionable step-by-step guidance.',
    ...options
  });
}

/**
 * Search for comparison information
 */
export async function searchCompare(items, criteria = [], options = {}) {
  const itemList = Array.isArray(items) ? items.join(' vs ') : items;
  const criteriaText = criteria.length > 0 ? `Focus on: ${criteria.join(', ')}` : '';

  const query = `Compare: ${itemList}. ${criteriaText}
Provide a balanced comparison with pros, cons, and recommendations.`;

  return search(query, {
    recencyFilter: 'month',
    systemPrompt: 'You are an analyst. Provide fair, balanced comparisons with clear criteria.',
    ...options
  });
}

// ============================================================================
// GROUNDING UTILITIES
// ============================================================================

/**
 * Assess verification status from answer
 */
function assessVerification(answer, claim) {
  const answerLower = answer.toLowerCase();

  // Check for verification indicators
  const verified = answerLower.includes('confirmed') ||
                   answerLower.includes('accurate') ||
                   answerLower.includes('correct') ||
                   answerLower.includes('verified') ||
                   answerLower.includes('true');

  const refuted = answerLower.includes('false') ||
                  answerLower.includes('incorrect') ||
                  answerLower.includes('inaccurate') ||
                  answerLower.includes('debunked') ||
                  answerLower.includes('misleading');

  const uncertain = answerLower.includes('unclear') ||
                    answerLower.includes('uncertain') ||
                    answerLower.includes('mixed') ||
                    answerLower.includes('depends') ||
                    answerLower.includes('partially');

  let status = 'unknown';
  if (verified && !refuted) status = 'verified';
  else if (refuted && !verified) status = 'refuted';
  else if (uncertain || (verified && refuted)) status = 'uncertain';

  return {
    status,
    indicators: { verified, refuted, uncertain }
  };
}

/**
 * Ground a statement with web search
 */
export async function ground(statement, options = {}) {
  const searchResult = await search(statement, {
    recencyFilter: options.recency || 'month',
    systemPrompt: `Verify and expand on this statement with current, factual information.
If the statement contains errors, correct them.
If it's accurate, confirm and add relevant context.`,
    ...options
  });

  return {
    original: statement,
    grounded: searchResult.answer,
    citations: searchResult.citations,
    confidence: searchResult.citations?.length > 2 ? 0.9 :
                searchResult.citations?.length > 0 ? 0.7 : 0.5,
    provider: searchResult.provider,
    timeMs: searchResult.timeMs
  };
}

/**
 * Answer a question with grounded information
 */
export async function groundedAnswer(question, context = '', options = {}) {
  const query = context
    ? `Context: ${context}\n\nQuestion: ${question}`
    : question;

  const result = await search(query, {
    recencyFilter: options.recency || 'month',
    systemPrompt: 'Answer the question with accurate, well-sourced information. Cite your sources.',
    ...options
  });

  return {
    question,
    answer: result.answer,
    citations: result.citations,
    grounded: result.grounded,
    confidence: result.citations?.length > 2 ? 0.9 :
                result.citations?.length > 0 ? 0.7 :
                result.grounded ? 0.6 : 0.4,
    provider: result.provider,
    timeMs: result.timeMs
  };
}

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

/**
 * Search multiple queries in parallel
 */
export async function searchBatch(queries, options = {}) {
  const results = await Promise.all(
    queries.map(q => search(q, options).catch(e => ({
      query: q,
      error: e.message
    })))
  );

  return {
    queries: queries.length,
    results,
    successCount: results.filter(r => !r.error).length,
    errorCount: results.filter(r => r.error).length
  };
}

/**
 * Verify multiple claims
 */
export async function verifyBatch(claims, options = {}) {
  const results = await Promise.all(
    claims.map(claim => searchFact(claim, options).catch(e => ({
      claim,
      error: e.message
    })))
  );

  const verified = results.filter(r => r.claimVerification?.status === 'verified').length;
  const refuted = results.filter(r => r.claimVerification?.status === 'refuted').length;

  return {
    claims: claims.length,
    results,
    summary: {
      verified,
      refuted,
      uncertain: claims.length - verified - refuted
    }
  };
}

// ============================================================================
// HISTORY & ANALYTICS
// ============================================================================

/**
 * Get search history
 */
export function getSearchHistory(limit = 50) {
  return searchHistory.slice(-limit);
}

/**
 * Get search statistics
 */
export function getSearchStats() {
  if (searchHistory.length === 0) {
    return { message: 'No search history yet' };
  }

  const providers = {};
  const recencyFilters = {};
  let totalTime = 0;
  let groundedCount = 0;

  searchHistory.forEach(s => {
    providers[s.provider] = (providers[s.provider] || 0) + 1;
    if (s.recencyFilter) {
      recencyFilters[s.recencyFilter] = (recencyFilters[s.recencyFilter] || 0) + 1;
    }
    totalTime += s.timeMs || 0;
    if (s.grounded) groundedCount++;
  });

  return {
    totalSearches: searchHistory.length,
    groundedSearches: groundedCount,
    groundingRate: `${Math.round(groundedCount / searchHistory.length * 100)}%`,
    averageTimeMs: Math.round(totalTime / searchHistory.length),
    providerBreakdown: providers,
    recencyBreakdown: recencyFilters
  };
}

/**
 * Clear search history
 */
export function clearHistory() {
  searchHistory.length = 0;
  return { success: true, message: 'Search history cleared' };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Core search
  search,
  // Specialized searches
  searchNews,
  searchFact,
  searchDocs,
  searchResearch,
  searchHowTo,
  searchCompare,
  // Grounding
  ground,
  groundedAnswer,
  // Batch
  searchBatch,
  verifyBatch,
  // History
  getSearchHistory,
  getSearchStats,
  clearHistory
};
