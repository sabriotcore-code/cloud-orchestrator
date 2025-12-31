// ============================================================================
// FIRECRAWL WEB SCRAPING SERVICE
// Intelligent content extraction from any webpage, PDF, or document
// ============================================================================

import fetch from 'node-fetch';

const FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v1';
let apiKey = null;

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initFirecrawl() {
  apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.log('[Firecrawl] Not configured - FIRECRAWL_API_KEY required');
    return false;
  }
  console.log('[Firecrawl] Web scraping ready');
  return true;
}

// ============================================================================
// CORE SCRAPING
// ============================================================================

/**
 * Scrape a single URL with full content extraction
 */
export async function scrapeUrl(url, options = {}) {
  if (!apiKey) initFirecrawl();
  if (!apiKey) throw new Error('Firecrawl not configured');

  const {
    formats = ['markdown', 'html'],
    onlyMainContent = true,
    includeTags = [],
    excludeTags = ['script', 'style', 'nav', 'footer'],
    waitFor = 0,
    timeout = 30000
  } = options;

  const response = await fetch(`${FIRECRAWL_API_URL}/scrape`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      url,
      formats,
      onlyMainContent,
      includeTags,
      excludeTags,
      waitFor,
      timeout
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Scrape failed: ${error}`);
  }

  const result = await response.json();
  return {
    success: result.success,
    url: result.data?.url || url,
    markdown: result.data?.markdown || '',
    html: result.data?.html || '',
    metadata: result.data?.metadata || {},
    links: result.data?.links || []
  };
}

/**
 * Crawl entire website starting from URL
 */
export async function crawlSite(url, options = {}) {
  if (!apiKey) initFirecrawl();
  if (!apiKey) throw new Error('Firecrawl not configured');

  const {
    limit = 50,
    maxDepth = 3,
    includePaths = [],
    excludePaths = [],
    allowBackwardLinks = false
  } = options;

  // Start crawl job
  const startResponse = await fetch(`${FIRECRAWL_API_URL}/crawl`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      url,
      limit,
      maxDepth,
      includePaths,
      excludePaths,
      allowBackwardLinks
    })
  });

  if (!startResponse.ok) {
    const error = await startResponse.text();
    throw new Error(`Crawl failed to start: ${error}`);
  }

  const { id: crawlId } = await startResponse.json();

  // Poll for results
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes max

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000));

    const statusResponse = await fetch(`${FIRECRAWL_API_URL}/crawl/${crawlId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    const status = await statusResponse.json();

    if (status.status === 'completed') {
      return {
        success: true,
        crawlId,
        pages: status.data || [],
        totalPages: status.total || 0
      };
    }

    if (status.status === 'failed') {
      throw new Error(`Crawl failed: ${status.error}`);
    }

    attempts++;
  }

  throw new Error('Crawl timed out');
}

/**
 * Extract structured data from a page
 */
export async function extractData(url, schema) {
  if (!apiKey) initFirecrawl();
  if (!apiKey) throw new Error('Firecrawl not configured');

  const response = await fetch(`${FIRECRAWL_API_URL}/scrape`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      url,
      formats: ['extract'],
      extract: { schema }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Extraction failed: ${error}`);
  }

  const result = await response.json();
  return {
    success: result.success,
    data: result.data?.extract || {},
    url: result.data?.url || url
  };
}

// ============================================================================
// CONTENT PROCESSING
// ============================================================================

/**
 * Get clean markdown content for AI consumption
 */
export async function getCleanContent(url) {
  const result = await scrapeUrl(url, {
    formats: ['markdown'],
    onlyMainContent: true,
    excludeTags: ['script', 'style', 'nav', 'footer', 'aside', 'advertisement']
  });

  return {
    url: result.url,
    title: result.metadata?.title || '',
    description: result.metadata?.description || '',
    content: result.markdown,
    wordCount: result.markdown.split(/\s+/).length
  };
}

/**
 * Summarize webpage content
 */
export async function summarizeUrl(url, maxLength = 500) {
  const content = await getCleanContent(url);

  // Return truncated content for now
  // In production, you'd send this to an AI for summarization
  const summary = content.content.length > maxLength
    ? content.content.substring(0, maxLength) + '...'
    : content.content;

  return {
    url: content.url,
    title: content.title,
    summary,
    fullContent: content.content
  };
}

/**
 * Extract all links from a page
 */
export async function extractLinks(url, options = {}) {
  const {
    internal = true,
    external = true,
    filterDomain = null
  } = options;

  const result = await scrapeUrl(url, { formats: ['links'] });

  let links = result.links || [];

  if (!internal) {
    links = links.filter(l => !l.startsWith(new URL(url).origin));
  }

  if (!external) {
    links = links.filter(l => l.startsWith(new URL(url).origin));
  }

  if (filterDomain) {
    links = links.filter(l => l.includes(filterDomain));
  }

  return { url, links };
}

// ============================================================================
// SPECIALIZED SCRAPERS
// ============================================================================

/**
 * Scrape GitHub repo README and docs
 */
export async function scrapeGitHubRepo(repoUrl) {
  const readmeResult = await scrapeUrl(`${repoUrl}#readme`, {
    formats: ['markdown'],
    onlyMainContent: true
  });

  return {
    url: repoUrl,
    readme: readmeResult.markdown,
    metadata: readmeResult.metadata
  };
}

/**
 * Scrape documentation site
 */
export async function scrapeDocumentation(baseUrl, options = {}) {
  const { maxPages = 20 } = options;

  const crawlResult = await crawlSite(baseUrl, {
    limit: maxPages,
    maxDepth: 3,
    includePaths: ['/docs', '/documentation', '/guide', '/api', '/reference']
  });

  return {
    baseUrl,
    pages: crawlResult.pages.map(p => ({
      url: p.url,
      title: p.metadata?.title,
      content: p.markdown
    })),
    totalPages: crawlResult.totalPages
  };
}

/**
 * Extract product/pricing info from webpage
 */
export async function scrapeProductInfo(url) {
  return extractData(url, {
    type: 'object',
    properties: {
      productName: { type: 'string' },
      price: { type: 'string' },
      description: { type: 'string' },
      features: { type: 'array', items: { type: 'string' } },
      rating: { type: 'string' },
      availability: { type: 'string' }
    }
  });
}

/**
 * Extract contact info from webpage
 */
export async function scrapeContactInfo(url) {
  return extractData(url, {
    type: 'object',
    properties: {
      email: { type: 'string' },
      phone: { type: 'string' },
      address: { type: 'string' },
      socialLinks: { type: 'array', items: { type: 'string' } }
    }
  });
}

/**
 * Scrape real estate listing
 */
export async function scrapePropertyListing(url) {
  return extractData(url, {
    type: 'object',
    properties: {
      address: { type: 'string' },
      price: { type: 'string' },
      bedrooms: { type: 'number' },
      bathrooms: { type: 'number' },
      squareFeet: { type: 'number' },
      description: { type: 'string' },
      features: { type: 'array', items: { type: 'string' } },
      agent: { type: 'string' },
      listingDate: { type: 'string' }
    }
  });
}

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

/**
 * Scrape multiple URLs in parallel
 */
export async function scrapeMultiple(urls, options = {}) {
  const { concurrency = 5 } = options;

  const results = [];

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(url => scrapeUrl(url, options))
    );

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      results.push({
        url: batch[j],
        success: result.status === 'fulfilled',
        data: result.status === 'fulfilled' ? result.value : null,
        error: result.status === 'rejected' ? result.reason.message : null
      });
    }
  }

  return results;
}

/**
 * Monitor a URL for changes
 */
export async function checkForChanges(url, previousHash = null) {
  const content = await getCleanContent(url);

  // Simple hash of content
  const hash = Buffer.from(content.content).toString('base64').substring(0, 32);

  return {
    url,
    currentHash: hash,
    previousHash,
    changed: previousHash ? hash !== previousHash : null,
    content: content.content
  };
}

// ============================================================================
// PDF AND DOCUMENT HANDLING
// ============================================================================

/**
 * Extract text from PDF URL
 */
export async function scrapePdf(url) {
  const result = await scrapeUrl(url, {
    formats: ['markdown'],
    onlyMainContent: false
  });

  return {
    url,
    content: result.markdown,
    metadata: result.metadata
  };
}

/**
 * Search within scraped content
 */
export async function searchInPage(url, query) {
  const content = await getCleanContent(url);

  const lines = content.content.split('\n');
  const matches = lines
    .map((line, idx) => ({ line, idx }))
    .filter(({ line }) => line.toLowerCase().includes(query.toLowerCase()));

  return {
    url,
    query,
    matches: matches.map(m => ({
      lineNumber: m.idx + 1,
      text: m.line.trim()
    })),
    totalMatches: matches.length
  };
}

// ============================================================================
// STATUS
// ============================================================================

export function getFirecrawlStatus() {
  return {
    configured: !!apiKey || !!process.env.FIRECRAWL_API_KEY,
    ready: !!apiKey
  };
}

export default {
  initFirecrawl,
  scrapeUrl,
  crawlSite,
  extractData,
  getCleanContent,
  summarizeUrl,
  extractLinks,
  scrapeGitHubRepo,
  scrapeDocumentation,
  scrapeProductInfo,
  scrapeContactInfo,
  scrapePropertyListing,
  scrapeMultiple,
  checkForChanges,
  scrapePdf,
  searchInPage,
  getFirecrawlStatus
};
