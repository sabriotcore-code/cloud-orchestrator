// ============================================================================
// SCIENTIFIC KNOWLEDGE SERVICE
// ArXiv, PubMed, Wikipedia, and research paper APIs
// ============================================================================

import fetch from 'node-fetch';
import OpenAI from 'openai';

// ============================================================================
// CONFIGURATION
// ============================================================================

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const WOLFRAM_APP_ID = process.env.WOLFRAM_APP_ID;

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    arxiv: true,           // Free, no key needed
    pubmed: true,          // Free, no key needed
    wikipedia: true,       // Free, no key needed
    wolfram: !!WOLFRAM_APP_ID,
    semanticScholar: true, // Free, no key needed
    ready: true
  };
}

// ============================================================================
// ARXIV (Free - no API key needed)
// ============================================================================

/**
 * Search arXiv for research papers
 * @param {string} query - Search query
 * @param {number} maxResults - Maximum results
 * @param {string} sortBy - relevance, lastUpdatedDate, submittedDate
 */
export async function searchArxiv(query, maxResults = 10, sortBy = 'relevance') {
  const encodedQuery = encodeURIComponent(query);
  const sortOrder = sortBy === 'relevance' ? 'relevance' : 'descending';
  const sortByParam = sortBy === 'relevance' ? '' : `&sortBy=${sortBy}&sortOrder=${sortOrder}`;

  const url = `http://export.arxiv.org/api/query?search_query=all:${encodedQuery}&start=0&max_results=${maxResults}${sortByParam}`;

  const response = await fetch(url);
  const xml = await response.text();

  // Parse XML response
  const entries = [];
  const entryMatches = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];

  for (const entry of entryMatches) {
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim();
    const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim();
    const published = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1];
    const arxivId = entry.match(/<id>http:\/\/arxiv\.org\/abs\/([\s\S]*?)<\/id>/)?.[1];
    const pdfLink = entry.match(/<link[^>]*type="application\/pdf"[^>]*href="([^"]+)"/)?.[1];

    const authors = [];
    const authorMatches = entry.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g) || [];
    for (const author of authorMatches) {
      const name = author.match(/<name>([\s\S]*?)<\/name>/)?.[1];
      if (name) authors.push(name);
    }

    const categories = [];
    const catMatches = entry.match(/<category[^>]*term="([^"]+)"/g) || [];
    for (const cat of catMatches) {
      const term = cat.match(/term="([^"]+)"/)?.[1];
      if (term) categories.push(term);
    }

    entries.push({
      title,
      authors,
      summary: summary?.substring(0, 500),
      published,
      arxivId,
      pdfLink,
      categories,
      url: `https://arxiv.org/abs/${arxivId}`
    });
  }

  return {
    query,
    resultCount: entries.length,
    papers: entries
  };
}

/**
 * Get paper details by arXiv ID
 */
export async function getArxivPaper(arxivId) {
  const url = `http://export.arxiv.org/api/query?id_list=${arxivId}`;
  const response = await fetch(url);
  const xml = await response.text();

  const result = await searchArxiv(`id:${arxivId}`, 1);
  return result.papers[0] || null;
}

// ============================================================================
// PUBMED (Free - no API key needed)
// ============================================================================

/**
 * Search PubMed for medical/life sciences papers
 */
export async function searchPubmed(query, maxResults = 10) {
  const encodedQuery = encodeURIComponent(query);

  // First, search for IDs
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodedQuery}&retmax=${maxResults}&retmode=json`;
  const searchResponse = await fetch(searchUrl);
  const searchData = await searchResponse.json();

  const ids = searchData.esearchresult?.idlist || [];

  if (ids.length === 0) {
    return { query, resultCount: 0, papers: [] };
  }

  // Fetch details for each ID
  const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
  const fetchResponse = await fetch(fetchUrl);
  const fetchData = await fetchResponse.json();

  const papers = ids.map(id => {
    const paper = fetchData.result?.[id];
    if (!paper) return null;

    return {
      pmid: id,
      title: paper.title,
      authors: paper.authors?.map(a => a.name) || [],
      source: paper.source,
      publishedDate: paper.pubdate,
      doi: paper.elocationid,
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`
    };
  }).filter(Boolean);

  return {
    query,
    resultCount: papers.length,
    papers
  };
}

/**
 * Get PubMed paper abstract
 */
export async function getPubmedAbstract(pmid) {
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=text`;
  const response = await fetch(url);
  const abstract = await response.text();

  return {
    pmid,
    abstract: abstract.trim(),
    url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
  };
}

// ============================================================================
// SEMANTIC SCHOLAR (Free tier available)
// ============================================================================

/**
 * Search Semantic Scholar for academic papers
 */
export async function searchSemanticScholar(query, limit = 10) {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodedQuery}&limit=${limit}&fields=title,authors,abstract,year,citationCount,url,openAccessPdf`;

  const response = await fetch(url);
  const data = await response.json();

  const papers = (data.data || []).map(paper => ({
    paperId: paper.paperId,
    title: paper.title,
    authors: paper.authors?.map(a => a.name) || [],
    abstract: paper.abstract?.substring(0, 500),
    year: paper.year,
    citations: paper.citationCount,
    url: paper.url,
    pdfUrl: paper.openAccessPdf?.url
  }));

  return {
    query,
    resultCount: papers.length,
    papers
  };
}

/**
 * Get paper citations
 */
export async function getPaperCitations(paperId, limit = 20) {
  const url = `https://api.semanticscholar.org/graph/v1/paper/${paperId}/citations?limit=${limit}&fields=title,authors,year,citationCount`;

  const response = await fetch(url);
  const data = await response.json();

  return {
    paperId,
    citations: (data.data || []).map(c => ({
      title: c.citingPaper?.title,
      authors: c.citingPaper?.authors?.map(a => a.name) || [],
      year: c.citingPaper?.year,
      citations: c.citingPaper?.citationCount
    }))
  };
}

// ============================================================================
// WIKIPEDIA (Free - no API key needed)
// ============================================================================

/**
 * Search Wikipedia
 */
export async function searchWikipedia(query, limit = 10) {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodedQuery}&srlimit=${limit}&format=json&origin=*`;

  const response = await fetch(url);
  const data = await response.json();

  const results = (data.query?.search || []).map(result => ({
    title: result.title,
    snippet: result.snippet.replace(/<[^>]+>/g, ''),
    pageId: result.pageid,
    wordCount: result.wordcount,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(result.title.replace(/ /g, '_'))}`
  }));

  return {
    query,
    resultCount: results.length,
    results
  };
}

/**
 * Get Wikipedia article summary
 */
export async function getWikipediaSummary(title) {
  const encodedTitle = encodeURIComponent(title);
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodedTitle}`;

  const response = await fetch(url);
  const data = await response.json();

  return {
    title: data.title,
    extract: data.extract,
    description: data.description,
    thumbnail: data.thumbnail?.source,
    url: data.content_urls?.desktop?.page
  };
}

/**
 * Get Wikipedia article full content
 */
export async function getWikipediaContent(title) {
  const encodedTitle = encodeURIComponent(title);
  const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodedTitle}&prop=extracts&exintro=false&explaintext=true&format=json&origin=*`;

  const response = await fetch(url);
  const data = await response.json();

  const pages = data.query?.pages || {};
  const page = Object.values(pages)[0];

  return {
    title: page?.title,
    content: page?.extract,
    pageId: page?.pageid
  };
}

// ============================================================================
// WOLFRAM ALPHA (Requires API key)
// ============================================================================

/**
 * Query Wolfram Alpha for computational knowledge
 */
export async function queryWolfram(query) {
  if (!WOLFRAM_APP_ID) {
    return {
      success: false,
      error: 'Wolfram Alpha API not configured',
      suggestion: 'Add WOLFRAM_APP_ID to environment variables'
    };
  }

  const encodedQuery = encodeURIComponent(query);
  const url = `https://api.wolframalpha.com/v2/query?input=${encodedQuery}&appid=${WOLFRAM_APP_ID}&output=json`;

  const response = await fetch(url);
  const data = await response.json();

  if (!data.queryresult?.success) {
    return {
      success: false,
      error: 'Query failed',
      tips: data.queryresult?.tips?.text
    };
  }

  const pods = (data.queryresult?.pods || []).map(pod => ({
    title: pod.title,
    values: pod.subpods?.map(sp => sp.plaintext).filter(Boolean) || []
  }));

  return {
    success: true,
    query,
    pods,
    primaryResult: pods.find(p => p.title === 'Result')?.values?.[0]
  };
}

/**
 * Get short answer from Wolfram Alpha
 */
export async function wolframShortAnswer(query) {
  if (!WOLFRAM_APP_ID) {
    return { error: 'Wolfram Alpha not configured' };
  }

  const encodedQuery = encodeURIComponent(query);
  const url = `https://api.wolframalpha.com/v1/result?i=${encodedQuery}&appid=${WOLFRAM_APP_ID}`;

  const response = await fetch(url);
  const answer = await response.text();

  return {
    query,
    answer: response.ok ? answer : null,
    error: !response.ok ? answer : null
  };
}

// ============================================================================
// MULTI-SOURCE RESEARCH
// ============================================================================

/**
 * Search across multiple academic sources
 */
export async function multiSourceSearch(query, sources = ['arxiv', 'pubmed', 'semantic']) {
  const results = {};

  const searches = sources.map(async source => {
    try {
      switch (source) {
        case 'arxiv':
          results.arxiv = await searchArxiv(query, 5);
          break;
        case 'pubmed':
          results.pubmed = await searchPubmed(query, 5);
          break;
        case 'semantic':
          results.semanticScholar = await searchSemanticScholar(query, 5);
          break;
        case 'wikipedia':
          results.wikipedia = await searchWikipedia(query, 3);
          break;
      }
    } catch (e) {
      results[source] = { error: e.message };
    }
  });

  await Promise.allSettled(searches);

  // Count total results
  let totalResults = 0;
  for (const source of Object.values(results)) {
    totalResults += source.resultCount || source.papers?.length || source.results?.length || 0;
  }

  return {
    query,
    sources: sources,
    totalResults,
    results
  };
}

/**
 * Synthesize research findings
 */
export async function synthesizeResearch(query, maxPapers = 10) {
  if (!openai) throw new Error('OpenAI API not configured');

  // Gather papers from multiple sources
  const research = await multiSourceSearch(query, ['arxiv', 'semantic']);

  // Collect abstracts
  const abstracts = [];

  for (const paper of (research.results.arxiv?.papers || [])) {
    if (paper.summary) {
      abstracts.push(`[${paper.title}] ${paper.summary}`);
    }
  }

  for (const paper of (research.results.semanticScholar?.papers || [])) {
    if (paper.abstract) {
      abstracts.push(`[${paper.title}] ${paper.abstract}`);
    }
  }

  if (abstracts.length === 0) {
    return { query, message: 'No research papers found' };
  }

  // Synthesize with AI
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'You are a research synthesis expert. Analyze academic papers and provide comprehensive summaries.'
      },
      {
        role: 'user',
        content: `Synthesize the findings from these research papers on "${query}":

${abstracts.slice(0, maxPapers).join('\n\n')}

Provide:
1. Key findings across papers
2. Common themes
3. Contradictions or debates
4. Research gaps
5. Practical implications
6. Suggested further reading`
      }
    ]
  });

  return {
    query,
    papersAnalyzed: abstracts.length,
    synthesis: response.choices[0].message.content,
    sources: research.results
  };
}

/**
 * Fact check a claim using scientific sources
 */
export async function factCheck(claim) {
  if (!openai) throw new Error('OpenAI API not configured');

  // Search for relevant research
  const research = await multiSourceSearch(claim, ['pubmed', 'wikipedia', 'semantic']);

  // Extract relevant content
  const evidence = [];

  for (const paper of (research.results.pubmed?.papers || []).slice(0, 3)) {
    evidence.push(`[PubMed: ${paper.title}]`);
  }

  for (const paper of (research.results.semanticScholar?.papers || []).slice(0, 3)) {
    if (paper.abstract) {
      evidence.push(`[Semantic Scholar: ${paper.title}] ${paper.abstract.substring(0, 200)}`);
    }
  }

  for (const result of (research.results.wikipedia?.results || []).slice(0, 2)) {
    evidence.push(`[Wikipedia: ${result.title}] ${result.snippet}`);
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'You are a fact-checker. Evaluate claims against scientific evidence.'
      },
      {
        role: 'user',
        content: `Fact-check this claim: "${claim}"

Available evidence:
${evidence.join('\n\n')}

Provide:
1. Verdict: TRUE / FALSE / PARTIALLY TRUE / UNVERIFIED
2. Confidence level (low/medium/high)
3. Supporting evidence
4. Contradicting evidence
5. Nuances or caveats
6. Sources to cite`
      }
    ]
  });

  return {
    claim,
    factCheck: response.choices[0].message.content,
    evidenceSources: evidence.length
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // ArXiv
  searchArxiv,
  getArxivPaper,
  // PubMed
  searchPubmed,
  getPubmedAbstract,
  // Semantic Scholar
  searchSemanticScholar,
  getPaperCitations,
  // Wikipedia
  searchWikipedia,
  getWikipediaSummary,
  getWikipediaContent,
  // Wolfram Alpha
  queryWolfram,
  wolframShortAnswer,
  // Multi-source
  multiSourceSearch,
  synthesizeResearch,
  factCheck
};
