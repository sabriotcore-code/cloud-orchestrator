// ============================================================================
// KNOWLEDGE SYSTEMS - External Knowledge APIs
// Wikipedia, Wolfram Alpha, ArXiv, News, Stack Overflow, etc.
// ============================================================================

// ============================================================================
// CONFIGURATION
// ============================================================================

const WOLFRAM_APP_ID = process.env.WOLFRAM_APP_ID;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const STACK_EXCHANGE_KEY = process.env.STACK_EXCHANGE_KEY;
const SEMANTIC_SCHOLAR_API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY;

// Query history
const queryHistory = [];

// ============================================================================
// WIKIPEDIA - Encyclopedic Knowledge
// ============================================================================

export async function wikiSearch(query, options = {}) {
  const { limit = 10, language = 'en' } = options;

  const response = await fetch(
    `https://${language}.wikipedia.org/w/api.php?` +
    `action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json&origin=*`
  );

  const data = await response.json();
  return {
    query,
    results: data.query?.search?.map(r => ({
      title: r.title,
      snippet: r.snippet.replace(/<[^>]+>/g, ''),
      pageId: r.pageid
    })) || [],
    source: 'wikipedia'
  };
}

export async function wikiSummary(title, options = {}) {
  const { language = 'en', sentences = 5 } = options;

  const response = await fetch(
    `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  );

  if (!response.ok) {
    return { error: 'Page not found', title };
  }

  const data = await response.json();
  return {
    title: data.title,
    extract: data.extract,
    description: data.description,
    thumbnail: data.thumbnail?.source,
    url: data.content_urls?.desktop?.page,
    source: 'wikipedia'
  };
}

export async function wikiFullContent(title, options = {}) {
  const { language = 'en' } = options;

  const response = await fetch(
    `https://${language}.wikipedia.org/w/api.php?` +
    `action=query&titles=${encodeURIComponent(title)}&prop=extracts&explaintext=true&format=json&origin=*`
  );

  const data = await response.json();
  const pages = data.query?.pages || {};
  const page = Object.values(pages)[0];

  return {
    title: page?.title,
    content: page?.extract,
    source: 'wikipedia'
  };
}

// ============================================================================
// WOLFRAM ALPHA - Computational Knowledge
// ============================================================================

export async function wolframQuery(query, options = {}) {
  if (!WOLFRAM_APP_ID) throw new Error('Wolfram Alpha not configured - set WOLFRAM_APP_ID');

  const { format = 'plaintext', timeout = 30 } = options;

  const response = await fetch(
    `https://api.wolframalpha.com/v2/query?` +
    `input=${encodeURIComponent(query)}&appid=${WOLFRAM_APP_ID}&output=json&format=${format}&podtimeout=${timeout}`
  );

  const data = await response.json();

  if (!data.queryresult?.success) {
    return {
      query,
      success: false,
      error: data.queryresult?.error?.msg || 'Query failed',
      didYouMean: data.queryresult?.didyoumeans,
      source: 'wolfram'
    };
  }

  const pods = data.queryresult.pods?.map(pod => ({
    title: pod.title,
    content: pod.subpods?.map(s => s.plaintext).filter(Boolean).join('\n'),
    image: pod.subpods?.[0]?.img?.src
  })) || [];

  return {
    query,
    success: true,
    pods,
    assumptions: data.queryresult.assumptions,
    source: 'wolfram'
  };
}

export async function wolframShort(query) {
  if (!WOLFRAM_APP_ID) throw new Error('Wolfram Alpha not configured');

  const response = await fetch(
    `https://api.wolframalpha.com/v1/result?i=${encodeURIComponent(query)}&appid=${WOLFRAM_APP_ID}`
  );

  if (!response.ok) return { query, result: null, error: 'No short answer available' };

  const text = await response.text();
  return { query, result: text, source: 'wolfram' };
}

export async function wolframSpoken(query) {
  if (!WOLFRAM_APP_ID) throw new Error('Wolfram Alpha not configured');

  const response = await fetch(
    `https://api.wolframalpha.com/v1/spoken?i=${encodeURIComponent(query)}&appid=${WOLFRAM_APP_ID}`
  );

  if (!response.ok) return { query, result: null, error: 'No spoken answer available' };

  const text = await response.text();
  return { query, spoken: text, source: 'wolfram' };
}

// ============================================================================
// ARXIV - Academic Papers
// ============================================================================

export async function arxivSearch(query, options = {}) {
  const { maxResults = 10, sortBy = 'relevance', sortOrder = 'descending' } = options;

  const response = await fetch(
    `http://export.arxiv.org/api/query?` +
    `search_query=all:${encodeURIComponent(query)}&start=0&max_results=${maxResults}&sortBy=${sortBy}&sortOrder=${sortOrder}`
  );

  const text = await response.text();

  // Parse XML (simple extraction)
  const entries = [];
  const entryMatches = text.match(/<entry>[\s\S]*?<\/entry>/g) || [];

  for (const entry of entryMatches) {
    const getTag = (tag) => {
      const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return match ? match[1].trim() : null;
    };

    entries.push({
      title: getTag('title')?.replace(/\s+/g, ' '),
      summary: getTag('summary')?.replace(/\s+/g, ' ').substring(0, 500),
      authors: (entry.match(/<name>([^<]+)<\/name>/g) || []).map(n => n.replace(/<\/?name>/g, '')),
      published: getTag('published'),
      updated: getTag('updated'),
      id: getTag('id'),
      pdfLink: entry.match(/href="([^"]+\.pdf)"/)?.[1]
    });
  }

  return {
    query,
    results: entries,
    count: entries.length,
    source: 'arxiv'
  };
}

export async function arxivPaper(arxivId) {
  const response = await fetch(`http://export.arxiv.org/api/query?id_list=${arxivId}`);
  const text = await response.text();

  const getTag = (tag) => {
    const match = text.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
    return match ? match[1].trim() : null;
  };

  return {
    id: arxivId,
    title: getTag('title')?.replace(/\s+/g, ' '),
    abstract: getTag('summary')?.replace(/\s+/g, ' '),
    authors: (text.match(/<name>([^<]+)<\/name>/g) || []).map(n => n.replace(/<\/?name>/g, '')),
    published: getTag('published'),
    categories: (text.match(/<category[^>]*term="([^"]+)"/g) || []).map(c => c.match(/term="([^"]+)"/)?.[1]),
    pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
    source: 'arxiv'
  };
}

// ============================================================================
// SEMANTIC SCHOLAR - Research Papers
// ============================================================================

export async function scholarSearch(query, options = {}) {
  const { limit = 10, fields = 'title,abstract,authors,year,citationCount,url' } = options;

  const headers = { 'Content-Type': 'application/json' };
  if (SEMANTIC_SCHOLAR_API_KEY) {
    headers['x-api-key'] = SEMANTIC_SCHOLAR_API_KEY;
  }

  const response = await fetch(
    `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`,
    { headers }
  );

  if (!response.ok) {
    return { query, error: 'Search failed', source: 'semantic_scholar' };
  }

  const data = await response.json();
  return {
    query,
    results: data.data?.map(p => ({
      title: p.title,
      abstract: p.abstract?.substring(0, 500),
      authors: p.authors?.map(a => a.name),
      year: p.year,
      citations: p.citationCount,
      url: p.url
    })) || [],
    total: data.total,
    source: 'semantic_scholar'
  };
}

export async function scholarPaper(paperId) {
  const fields = 'title,abstract,authors,year,citationCount,referenceCount,url,venue,publicationDate,citations,references';

  const headers = { 'Content-Type': 'application/json' };
  if (SEMANTIC_SCHOLAR_API_KEY) {
    headers['x-api-key'] = SEMANTIC_SCHOLAR_API_KEY;
  }

  const response = await fetch(
    `https://api.semanticscholar.org/graph/v1/paper/${paperId}?fields=${fields}`,
    { headers }
  );

  if (!response.ok) {
    return { paperId, error: 'Paper not found', source: 'semantic_scholar' };
  }

  return { ...(await response.json()), source: 'semantic_scholar' };
}

// ============================================================================
// NEWS API - Current Events
// ============================================================================

export async function newsSearch(query, options = {}) {
  if (!NEWS_API_KEY) throw new Error('News API not configured - set NEWS_API_KEY');

  const { language = 'en', sortBy = 'relevancy', pageSize = 10 } = options;

  const response = await fetch(
    `https://newsapi.org/v2/everything?` +
    `q=${encodeURIComponent(query)}&language=${language}&sortBy=${sortBy}&pageSize=${pageSize}&apiKey=${NEWS_API_KEY}`
  );

  const data = await response.json();

  if (data.status !== 'ok') {
    return { query, error: data.message, source: 'newsapi' };
  }

  return {
    query,
    articles: data.articles?.map(a => ({
      title: a.title,
      description: a.description,
      source: a.source?.name,
      author: a.author,
      publishedAt: a.publishedAt,
      url: a.url,
      imageUrl: a.urlToImage
    })) || [],
    totalResults: data.totalResults,
    source: 'newsapi'
  };
}

export async function newsHeadlines(options = {}) {
  if (!NEWS_API_KEY) throw new Error('News API not configured');

  const { country = 'us', category = 'general', pageSize = 10 } = options;

  const response = await fetch(
    `https://newsapi.org/v2/top-headlines?` +
    `country=${country}&category=${category}&pageSize=${pageSize}&apiKey=${NEWS_API_KEY}`
  );

  const data = await response.json();

  return {
    category,
    country,
    articles: data.articles?.map(a => ({
      title: a.title,
      description: a.description,
      source: a.source?.name,
      publishedAt: a.publishedAt,
      url: a.url
    })) || [],
    source: 'newsapi'
  };
}

// ============================================================================
// STACK OVERFLOW - Programming Knowledge
// ============================================================================

export async function stackSearch(query, options = {}) {
  const { tagged = '', sort = 'relevance', pageSize = 10, site = 'stackoverflow' } = options;

  let url = `https://api.stackexchange.com/2.3/search/advanced?` +
    `q=${encodeURIComponent(query)}&sort=${sort}&pagesize=${pageSize}&site=${site}&filter=withbody`;

  if (tagged) url += `&tagged=${tagged}`;
  if (STACK_EXCHANGE_KEY) url += `&key=${STACK_EXCHANGE_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  return {
    query,
    questions: data.items?.map(q => ({
      title: q.title,
      body: q.body?.substring(0, 500),
      tags: q.tags,
      score: q.score,
      answerCount: q.answer_count,
      isAnswered: q.is_answered,
      link: q.link,
      creationDate: new Date(q.creation_date * 1000).toISOString()
    })) || [],
    hasMore: data.has_more,
    source: 'stackoverflow'
  };
}

export async function stackQuestion(questionId) {
  let url = `https://api.stackexchange.com/2.3/questions/${questionId}?` +
    `site=stackoverflow&filter=withbody`;

  if (STACK_EXCHANGE_KEY) url += `&key=${STACK_EXCHANGE_KEY}`;

  const response = await fetch(url);
  const data = await response.json();
  const q = data.items?.[0];

  if (!q) return { questionId, error: 'Question not found', source: 'stackoverflow' };

  return {
    title: q.title,
    body: q.body,
    tags: q.tags,
    score: q.score,
    answerCount: q.answer_count,
    link: q.link,
    source: 'stackoverflow'
  };
}

export async function stackAnswers(questionId) {
  let url = `https://api.stackexchange.com/2.3/questions/${questionId}/answers?` +
    `site=stackoverflow&sort=votes&filter=withbody`;

  if (STACK_EXCHANGE_KEY) url += `&key=${STACK_EXCHANGE_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  return {
    questionId,
    answers: data.items?.map(a => ({
      body: a.body,
      score: a.score,
      isAccepted: a.is_accepted,
      creationDate: new Date(a.creation_date * 1000).toISOString()
    })) || [],
    source: 'stackoverflow'
  };
}

// ============================================================================
// UNIFIED KNOWLEDGE QUERY
// ============================================================================

export async function queryKnowledge(query, options = {}) {
  const {
    sources = ['wikipedia', 'wolfram'],
    parallel = true
  } = options;

  const sourceHandlers = {
    wikipedia: () => wikiSearch(query).then(r => ({ source: 'wikipedia', ...r })),
    wolfram: WOLFRAM_APP_ID ? () => wolframShort(query).then(r => ({ source: 'wolfram', ...r })) : null,
    arxiv: () => arxivSearch(query, { maxResults: 5 }).then(r => ({ source: 'arxiv', ...r })),
    scholar: () => scholarSearch(query, { limit: 5 }).then(r => ({ source: 'scholar', ...r })),
    news: NEWS_API_KEY ? () => newsSearch(query, { pageSize: 5 }).then(r => ({ source: 'news', ...r })) : null,
    stackoverflow: () => stackSearch(query, { pageSize: 5 }).then(r => ({ source: 'stackoverflow', ...r }))
  };

  const activeSources = sources.filter(s => sourceHandlers[s]);

  if (parallel) {
    const results = await Promise.allSettled(
      activeSources.map(s => sourceHandlers[s]().catch(e => ({ source: s, error: e.message })))
    );

    return {
      query,
      results: results.map(r => r.status === 'fulfilled' ? r.value : { error: 'Failed' }),
      sourcesQueried: activeSources
    };
  }

  // Sequential
  const results = [];
  for (const source of activeSources) {
    try {
      results.push(await sourceHandlers[source]());
    } catch (e) {
      results.push({ source, error: e.message });
    }
  }

  return { query, results, sourcesQueried: activeSources };
}

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    wikipedia: true,
    wolframAlpha: !!WOLFRAM_APP_ID,
    arxiv: true,
    semanticScholar: true,
    newsApi: !!NEWS_API_KEY,
    stackOverflow: true,
    availableSources: [
      'wikipedia',
      WOLFRAM_APP_ID && 'wolfram',
      'arxiv',
      'semantic_scholar',
      NEWS_API_KEY && 'news',
      'stackoverflow'
    ].filter(Boolean),
    ready: true
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Wikipedia
  wikiSearch, wikiSummary, wikiFullContent,
  // Wolfram Alpha
  wolframQuery, wolframShort, wolframSpoken,
  // ArXiv
  arxivSearch, arxivPaper,
  // Semantic Scholar
  scholarSearch, scholarPaper,
  // News
  newsSearch, newsHeadlines,
  // Stack Overflow
  stackSearch, stackQuestion, stackAnswers,
  // Unified
  queryKnowledge
};
