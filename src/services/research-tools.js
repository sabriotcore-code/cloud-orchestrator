// ============================================================================
// RESEARCH TOOLS - Papers, Citations, Patents, Literature Review
// Advanced research and academic tools
// ============================================================================

import OpenAI from 'openai';

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ============================================================================
// PAPER SEARCH & ANALYSIS
// ============================================================================

/**
 * Search academic papers across multiple sources
 */
export async function searchPapers(query, options = {}) {
  const { sources = ['arxiv', 'semantic_scholar'], limit = 10 } = options;

  const results = await Promise.allSettled(
    sources.map(source => searchPaperSource(query, source, limit))
  );

  const papers = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      papers.push(...result.value.map(p => ({ ...p, source: sources[i] })));
    }
  });

  // Deduplicate by title similarity
  const unique = deduplicatePapers(papers);

  return {
    query,
    papers: unique.slice(0, limit),
    totalFound: unique.length,
    sources: sources
  };
}

async function searchPaperSource(query, source, limit) {
  switch (source) {
    case 'arxiv':
      return searchArxiv(query, limit);
    case 'semantic_scholar':
      return searchSemanticScholar(query, limit);
    case 'pubmed':
      return searchPubMed(query, limit);
    default:
      return [];
  }
}

async function searchArxiv(query, limit) {
  const response = await fetch(
    `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${limit}`
  );
  const text = await response.text();

  const papers = [];
  const entries = text.match(/<entry>[\s\S]*?<\/entry>/g) || [];

  for (const entry of entries) {
    const getTag = (tag) => {
      const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return match ? match[1].trim() : null;
    };

    papers.push({
      title: getTag('title')?.replace(/\s+/g, ' '),
      abstract: getTag('summary')?.replace(/\s+/g, ' ').substring(0, 500),
      authors: (entry.match(/<name>([^<]+)<\/name>/g) || []).map(n => n.replace(/<\/?name>/g, '')),
      published: getTag('published'),
      url: getTag('id'),
      pdfUrl: entry.match(/href="([^"]+\.pdf)"/)?.[1]
    });
  }

  return papers;
}

async function searchSemanticScholar(query, limit) {
  const response = await fetch(
    `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=title,abstract,authors,year,citationCount,url`
  );

  if (!response.ok) return [];

  const data = await response.json();
  return (data.data || []).map(p => ({
    title: p.title,
    abstract: p.abstract?.substring(0, 500),
    authors: p.authors?.map(a => a.name) || [],
    year: p.year,
    citations: p.citationCount,
    url: p.url
  }));
}

async function searchPubMed(query, limit) {
  // PubMed E-utilities
  const searchResponse = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${limit}&retmode=json`
  );

  const searchData = await searchResponse.json();
  const ids = searchData.esearchresult?.idlist || [];

  if (ids.length === 0) return [];

  const summaryResponse = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`
  );

  const summaryData = await summaryResponse.json();
  const papers = [];

  for (const id of ids) {
    const doc = summaryData.result?.[id];
    if (doc) {
      papers.push({
        title: doc.title,
        authors: doc.authors?.map(a => a.name) || [],
        year: doc.pubdate?.split(' ')[0],
        journal: doc.source,
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`
      });
    }
  }

  return papers;
}

function deduplicatePapers(papers) {
  const seen = new Set();
  return papers.filter(paper => {
    const key = paper.title?.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Analyze a paper
 */
export async function analyzePaper(paperContent, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Analyze this academic paper. Return JSON:
{
  "title": "paper title",
  "summary": "concise summary",
  "keyFindings": ["finding 1", "finding 2"],
  "methodology": "methods used",
  "contributions": ["main contributions"],
  "limitations": ["limitations"],
  "implications": ["implications for the field"],
  "relatedTopics": ["related research areas"],
  "technicalLevel": "beginner/intermediate/advanced",
  "quality": 0-10
}`
      },
      { role: 'user', content: paperContent.substring(0, 15000) }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// CITATION ANALYSIS
// ============================================================================

/**
 * Get citations for a paper
 */
export async function getCitations(paperId, source = 'semantic_scholar') {
  if (source === 'semantic_scholar') {
    const response = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/${paperId}/citations?fields=title,authors,year,citationCount`
    );

    if (!response.ok) return { error: 'Paper not found' };

    const data = await response.json();
    return {
      paperId,
      citations: (data.data || []).map(c => ({
        title: c.citingPaper?.title,
        authors: c.citingPaper?.authors?.map(a => a.name),
        year: c.citingPaper?.year,
        citations: c.citingPaper?.citationCount
      })),
      totalCitations: data.data?.length || 0
    };
  }

  return { error: 'Unsupported source' };
}

/**
 * Get references from a paper
 */
export async function getReferences(paperId, source = 'semantic_scholar') {
  if (source === 'semantic_scholar') {
    const response = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/${paperId}/references?fields=title,authors,year,citationCount`
    );

    if (!response.ok) return { error: 'Paper not found' };

    const data = await response.json();
    return {
      paperId,
      references: (data.data || []).map(r => ({
        title: r.citedPaper?.title,
        authors: r.citedPaper?.authors?.map(a => a.name),
        year: r.citedPaper?.year,
        citations: r.citedPaper?.citationCount
      })),
      totalReferences: data.data?.length || 0
    };
  }

  return { error: 'Unsupported source' };
}

/**
 * Analyze citation network
 */
export async function analyzeCitationNetwork(papers, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Analyze citation patterns and relationships. Return JSON:
{
  "keyPapers": ["most influential papers"],
  "citationClusters": [{"theme": "cluster theme", "papers": ["paper titles"]}],
  "trends": ["citation trends observed"],
  "gaps": ["research gaps identified"],
  "emergingTopics": ["emerging research directions"],
  "influentialAuthors": ["key authors in the field"]
}`
      },
      { role: 'user', content: JSON.stringify(papers) }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// LITERATURE REVIEW
// ============================================================================

/**
 * Generate literature review
 */
export async function generateLiteratureReview(topic, papers, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { style = 'academic', length = 'comprehensive' } = options;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Write a ${length} ${style} literature review. Return JSON:
{
  "title": "review title",
  "abstract": "review abstract",
  "introduction": "introduction section",
  "themes": [
    {
      "name": "theme name",
      "content": "theme discussion",
      "keyPapers": ["papers supporting this theme"]
    }
  ],
  "gaps": "research gaps section",
  "futureDirections": "future research directions",
  "conclusion": "conclusion section",
  "references": ["formatted references"]
}`
      },
      {
        role: 'user',
        content: `Topic: ${topic}\n\nPapers to include:\n${JSON.stringify(papers, null, 2)}`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 4000
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Summarize multiple papers
 */
export async function summarizePapers(papers, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Synthesize findings across multiple papers. Return JSON:
{
  "overallSummary": "synthesis of all papers",
  "commonFindings": ["findings that appear across papers"],
  "contradictions": ["contradictory findings"],
  "methodologicalApproaches": ["methods used across papers"],
  "paperSummaries": [{"title": "paper title", "keyPoints": ["key points"]}],
  "researchQuestions": ["questions that arise from this research"]
}`
      },
      { role: 'user', content: JSON.stringify(papers) }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 3000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// PATENT SEARCH
// ============================================================================

/**
 * Search patents
 */
export async function searchPatents(query, options = {}) {
  // Using Google Patents API (simplified)
  const { limit = 10 } = options;

  // Note: Google Patents doesn't have a public API
  // This would need to use a patent API service like PatentsView, EPO, or USPTO
  // For now, returning a placeholder structure

  return {
    query,
    note: 'Patent search requires API key. Configure PATENT_API_KEY for full functionality.',
    suggestedServices: ['PatentsView (USPTO)', 'EPO Open Patent Services', 'Google Patents'],
    placeholder: true
  };
}

/**
 * Analyze patent
 */
export async function analyzePatent(patentContent, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Analyze this patent. Return JSON:
{
  "title": "patent title",
  "abstract": "brief abstract",
  "claims": ["main claims"],
  "novelty": "what makes this novel",
  "priorArt": ["related prior art considerations"],
  "applications": ["potential applications"],
  "technicalField": "field of invention",
  "inventors": ["inventor names if found"],
  "keyTerms": ["important technical terms"]
}`
      },
      { role: 'user', content: patentContent.substring(0, 15000) }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// RESEARCH PLANNING
// ============================================================================

/**
 * Generate research plan
 */
export async function generateResearchPlan(topic, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { scope = 'comprehensive', duration = '6 months' } = options;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Create a ${scope} research plan for ${duration}. Return JSON:
{
  "title": "research project title",
  "objectives": ["research objective 1", "objective 2"],
  "researchQuestions": ["RQ1", "RQ2"],
  "methodology": {
    "approach": "research approach",
    "methods": ["method 1", "method 2"],
    "dataCollection": "how data will be collected",
    "analysis": "analysis approach"
  },
  "timeline": [
    {"phase": "phase name", "duration": "X weeks", "activities": ["activity"]}
  ],
  "resources": ["resources needed"],
  "risks": [{"risk": "description", "mitigation": "how to mitigate"}],
  "expectedOutcomes": ["expected outcome"],
  "milestones": [{"milestone": "name", "deliverable": "what", "date": "when"}]
}`
      },
      { role: 'user', content: `Research topic: ${topic}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2500
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Identify research gaps
 */
export async function identifyResearchGaps(topic, existingResearch, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Identify research gaps and opportunities. Return JSON:
{
  "gaps": [
    {
      "gap": "description of gap",
      "importance": "high/medium/low",
      "difficulty": "high/medium/low",
      "potentialImpact": "potential impact if addressed",
      "suggestedApproach": "how to address this gap"
    }
  ],
  "underexploredAreas": ["areas needing more research"],
  "methodologicalGaps": ["gaps in methods"],
  "theoreticalGaps": ["gaps in theory"],
  "recommendations": ["recommended research directions"]
}`
      },
      {
        role: 'user',
        content: `Topic: ${topic}\nExisting research: ${JSON.stringify(existingResearch)}`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// HYPOTHESIS GENERATION
// ============================================================================

/**
 * Generate research hypotheses
 */
export async function generateHypotheses(topic, context, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { count = 5, type = 'testable' } = options;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Generate ${count} ${type} research hypotheses. Return JSON:
{
  "hypotheses": [
    {
      "hypothesis": "the hypothesis statement",
      "rationale": "why this is worth testing",
      "variables": {"independent": "...", "dependent": "..."},
      "testMethod": "how to test this",
      "expectedOutcome": "what we expect if true",
      "alternativeOutcome": "what it means if false",
      "feasibility": "high/medium/low"
    }
  ],
  "researchFramework": "overarching framework connecting hypotheses"
}`
      },
      {
        role: 'user',
        content: `Topic: ${topic}\nContext: ${context}`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2500
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// METHODOLOGY DESIGN
// ============================================================================

/**
 * Design research methodology
 */
export async function designMethodology(researchQuestion, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { paradigm = 'mixed', constraints = [] } = options;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Design a ${paradigm} research methodology. Return JSON:
{
  "researchDesign": {
    "type": "experimental/correlational/qualitative/mixed",
    "rationale": "why this design"
  },
  "participants": {
    "population": "target population",
    "sampling": "sampling method",
    "sampleSize": "recommended size and justification"
  },
  "dataCollection": {
    "methods": ["method 1", "method 2"],
    "instruments": ["instrument 1"],
    "procedure": "data collection procedure"
  },
  "analysis": {
    "quantitative": ["analysis methods"],
    "qualitative": ["analysis methods"],
    "software": ["recommended software"]
  },
  "validity": {
    "internal": "how to ensure internal validity",
    "external": "how to ensure external validity"
  },
  "ethics": ["ethical considerations"],
  "limitations": ["potential limitations"]
}`
      },
      {
        role: 'user',
        content: `Research question: ${researchQuestion}
Constraints: ${constraints.join(', ')}`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2500
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    paperSearch: true,
    paperAnalysis: !!openai,
    citationAnalysis: true,
    literatureReview: !!openai,
    patentSearch: false, // Requires API key
    researchPlanning: !!openai,
    hypothesisGeneration: !!openai,
    methodologyDesign: !!openai,
    capabilities: [
      'paper_search', 'paper_analysis', 'arxiv_search', 'semantic_scholar_search',
      'pubmed_search', 'citation_analysis', 'reference_analysis',
      'citation_network_analysis', 'literature_review_generation',
      'paper_summarization', 'patent_search', 'patent_analysis',
      'research_planning', 'gap_identification', 'hypothesis_generation',
      'methodology_design'
    ],
    ready: true
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Paper Search
  searchPapers, analyzePaper,
  // Citations
  getCitations, getReferences, analyzeCitationNetwork,
  // Literature Review
  generateLiteratureReview, summarizePapers,
  // Patents
  searchPatents, analyzePatent,
  // Research Planning
  generateResearchPlan, identifyResearchGaps,
  // Hypotheses & Methodology
  generateHypotheses, designMethodology
};
