// ============================================================================
// MULTI-SOURCE VERIFY SERVICE - Cross-Reference Truth Checking
// Verifies claims across multiple authoritative sources
// ============================================================================

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// ============================================================================
// CONFIGURATION
// ============================================================================

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// Verification history
const verificationHistory = [];

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    multiSourceVerification: true,
    consensusChecking: true,
    confidenceScoring: true,
    claimExtraction: true,
    verificationCount: verificationHistory.length,
    ready: !!(openai || anthropic)
  };
}

// ============================================================================
// SOURCE DEFINITIONS
// ============================================================================

const SOURCES = {
  // AI Providers as sources (each has different training data)
  claude: {
    name: 'Claude (Anthropic)',
    type: 'ai',
    reliability: 0.85,
    strengths: ['reasoning', 'nuance', 'analysis']
  },
  gpt: {
    name: 'GPT-4 (OpenAI)',
    type: 'ai',
    reliability: 0.85,
    strengths: ['breadth', 'coding', 'structured']
  },
  gemini: {
    name: 'Gemini (Google)',
    type: 'ai',
    reliability: 0.80,
    strengths: ['multimodal', 'current', 'technical']
  },

  // Simulated external sources (would be real API calls in production)
  wikipedia: {
    name: 'Wikipedia',
    type: 'encyclopedia',
    reliability: 0.75,
    strengths: ['breadth', 'citations', 'history']
  },
  arxiv: {
    name: 'arXiv',
    type: 'academic',
    reliability: 0.90,
    strengths: ['research', 'technical', 'recent']
  },
  pubmed: {
    name: 'PubMed',
    type: 'medical',
    reliability: 0.95,
    strengths: ['medical', 'clinical', 'peer-reviewed']
  }
};

// ============================================================================
// CORE VERIFICATION
// ============================================================================

/**
 * Verify a claim across multiple sources
 * @param {string} claim - The claim to verify
 * @param {object} options - Verification options
 */
export async function verify(claim, options = {}) {
  const {
    sources = ['claude', 'gpt'],
    threshold = 0.7,
    includeEvidence = true,
    requireConsensus = true
  } = options;

  const startTime = Date.now();
  const results = [];

  // Query each source in parallel
  const sourcePromises = sources.map(source =>
    querySource(source, claim, includeEvidence).catch(e => ({
      source,
      error: e.message
    }))
  );

  const sourceResults = await Promise.all(sourcePromises);

  // Filter successful results
  const validResults = sourceResults.filter(r => !r.error);
  const errors = sourceResults.filter(r => r.error);

  // Calculate consensus
  const consensus = calculateConsensus(validResults);

  // Determine verdict
  const verdict = determineVerdict(consensus, threshold, requireConsensus);

  const result = {
    claim,
    verdict: verdict.status,
    confidence: verdict.confidence,
    consensus,
    sources: validResults,
    errors,
    evidence: includeEvidence ? extractEvidence(validResults) : null,
    reasoning: verdict.reasoning,
    threshold,
    timeMs: Date.now() - startTime,
    timestamp: new Date().toISOString()
  };

  // Store in history
  verificationHistory.push(result);
  if (verificationHistory.length > 200) verificationHistory.shift();

  return result;
}

/**
 * Query a single source for verification
 */
async function querySource(sourceName, claim, includeEvidence) {
  const source = SOURCES[sourceName];
  if (!source) throw new Error(`Unknown source: ${sourceName}`);

  const prompt = `Evaluate this claim for accuracy:

CLAIM: "${claim}"

Assess:
1. Is this claim TRUE, FALSE, PARTIALLY TRUE, or UNCERTAIN?
2. What is your confidence (0-100%)?
3. What evidence supports or refutes this?
4. Are there any caveats or nuances?

Return JSON:
{
  "verdict": "TRUE" | "FALSE" | "PARTIALLY_TRUE" | "UNCERTAIN",
  "confidence": 0-100,
  "evidence": ["point1", "point2"],
  "caveats": ["caveat1"],
  "reasoning": "brief explanation"
}`;

  let response;

  if (sourceName === 'claude' && anthropic) {
    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });
    response = result.content[0].text;
  } else if ((sourceName === 'gpt' || sourceName === 'gemini') && openai) {
    const result = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    response = result.choices[0].message.content;
  } else {
    // Simulate other sources
    return simulateSource(sourceName, claim);
  }

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        source: sourceName,
        sourceName: source.name,
        sourceType: source.type,
        reliability: source.reliability,
        verdict: parsed.verdict,
        confidence: parsed.confidence / 100,
        evidence: parsed.evidence || [],
        caveats: parsed.caveats || [],
        reasoning: parsed.reasoning
      };
    }
  } catch (e) {
    // Fallback parsing
  }

  return {
    source: sourceName,
    sourceName: source.name,
    verdict: 'UNCERTAIN',
    confidence: 0.5,
    evidence: [],
    reasoning: 'Could not parse response'
  };
}

/**
 * Simulate a source response (placeholder for real APIs)
 */
function simulateSource(sourceName, claim) {
  const source = SOURCES[sourceName];

  return {
    source: sourceName,
    sourceName: source?.name || sourceName,
    sourceType: source?.type || 'unknown',
    reliability: source?.reliability || 0.5,
    verdict: 'UNCERTAIN',
    confidence: 0.5,
    evidence: [],
    caveats: ['Simulated response - real API not connected'],
    reasoning: 'Source simulation - would query real API in production',
    simulated: true
  };
}

// ============================================================================
// CONSENSUS CALCULATION
// ============================================================================

/**
 * Calculate consensus across sources
 */
function calculateConsensus(results) {
  if (results.length === 0) {
    return { agreement: 0, majority: 'UNCERTAIN', weighted: 0 };
  }

  // Count verdicts
  const verdictCounts = {};
  let weightedTrue = 0;
  let weightedFalse = 0;
  let totalWeight = 0;

  results.forEach(r => {
    verdictCounts[r.verdict] = (verdictCounts[r.verdict] || 0) + 1;

    const weight = (r.reliability || 0.5) * (r.confidence || 0.5);
    totalWeight += weight;

    if (r.verdict === 'TRUE') weightedTrue += weight;
    else if (r.verdict === 'FALSE') weightedFalse += weight;
  });

  // Find majority
  const sortedVerdicts = Object.entries(verdictCounts)
    .sort((a, b) => b[1] - a[1]);
  const majority = sortedVerdicts[0]?.[0] || 'UNCERTAIN';
  const majorityCount = sortedVerdicts[0]?.[1] || 0;

  // Calculate agreement
  const agreement = majorityCount / results.length;

  // Calculate weighted score (-1 to 1, negative = false, positive = true)
  const weightedScore = totalWeight > 0
    ? (weightedTrue - weightedFalse) / totalWeight
    : 0;

  return {
    agreement,
    majority,
    verdictCounts,
    weightedScore,
    sourcesQueried: results.length,
    averageConfidence: results.reduce((s, r) => s + (r.confidence || 0), 0) / results.length
  };
}

/**
 * Determine final verdict from consensus
 */
function determineVerdict(consensus, threshold, requireConsensus) {
  const { agreement, majority, weightedScore, averageConfidence } = consensus;

  // Strong consensus required
  if (requireConsensus && agreement < threshold) {
    return {
      status: 'UNCERTAIN',
      confidence: averageConfidence * agreement,
      reasoning: `Insufficient consensus (${Math.round(agreement * 100)}% < ${Math.round(threshold * 100)}% threshold)`
    };
  }

  // Use weighted score for final determination
  if (weightedScore > 0.3) {
    return {
      status: 'VERIFIED',
      confidence: Math.min(0.95, averageConfidence * (0.5 + weightedScore / 2)),
      reasoning: `Weighted evidence supports claim (score: ${weightedScore.toFixed(2)})`
    };
  } else if (weightedScore < -0.3) {
    return {
      status: 'REFUTED',
      confidence: Math.min(0.95, averageConfidence * (0.5 + Math.abs(weightedScore) / 2)),
      reasoning: `Weighted evidence refutes claim (score: ${weightedScore.toFixed(2)})`
    };
  } else {
    return {
      status: majority === 'PARTIALLY_TRUE' ? 'PARTIALLY_VERIFIED' : 'UNCERTAIN',
      confidence: averageConfidence * 0.6,
      reasoning: `Mixed or insufficient evidence (score: ${weightedScore.toFixed(2)})`
    };
  }
}

/**
 * Extract combined evidence from all sources
 */
function extractEvidence(results) {
  const supporting = [];
  const refuting = [];
  const caveats = [];

  results.forEach(r => {
    if (r.verdict === 'TRUE' || r.verdict === 'PARTIALLY_TRUE') {
      supporting.push(...(r.evidence || []));
    } else if (r.verdict === 'FALSE') {
      refuting.push(...(r.evidence || []));
    }
    caveats.push(...(r.caveats || []));
  });

  return {
    supporting: [...new Set(supporting)],
    refuting: [...new Set(refuting)],
    caveats: [...new Set(caveats)]
  };
}

// ============================================================================
// SPECIALIZED VERIFICATION
// ============================================================================

/**
 * Quick verification with default sources
 */
export async function quickVerify(claim) {
  return verify(claim, {
    sources: ['claude', 'gpt'],
    threshold: 0.6,
    includeEvidence: false
  });
}

/**
 * Deep verification with all available sources
 */
export async function deepVerify(claim) {
  return verify(claim, {
    sources: ['claude', 'gpt', 'wikipedia', 'arxiv'],
    threshold: 0.7,
    includeEvidence: true,
    requireConsensus: true
  });
}

/**
 * Verify a list of claims
 */
export async function verifyBatch(claims, options = {}) {
  const results = await Promise.all(
    claims.map(claim => verify(claim, options).catch(e => ({
      claim,
      verdict: 'ERROR',
      error: e.message
    })))
  );

  const summary = {
    total: claims.length,
    verified: results.filter(r => r.verdict === 'VERIFIED').length,
    refuted: results.filter(r => r.verdict === 'REFUTED').length,
    uncertain: results.filter(r => r.verdict === 'UNCERTAIN' || r.verdict === 'PARTIALLY_VERIFIED').length,
    errors: results.filter(r => r.verdict === 'ERROR').length
  };

  return { results, summary };
}

/**
 * Extract and verify claims from text
 */
export async function extractAndVerify(text, options = {}) {
  // First, extract claims from the text
  const claims = await extractClaims(text);

  if (claims.length === 0) {
    return { text, claims: [], message: 'No verifiable claims found' };
  }

  // Verify each claim
  const verifiedClaims = await verifyBatch(claims, options);

  return {
    text,
    extractedClaims: claims,
    verifications: verifiedClaims.results,
    summary: verifiedClaims.summary
  };
}

/**
 * Extract verifiable claims from text
 */
async function extractClaims(text) {
  if (!openai && !anthropic) return [];

  const prompt = `Extract factual claims from this text that can be verified.
Only include specific, concrete claims (not opinions or subjective statements).

TEXT:
${text}

Return JSON array of claims:
["claim 1", "claim 2", ...]`;

  let response;
  if (anthropic) {
    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });
    response = result.content[0].text;
  } else {
    const result = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    response = result.choices[0].message.content;
  }

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    // Fallback
  }

  return [];
}

// ============================================================================
// COMPARISON VERIFICATION
// ============================================================================

/**
 * Compare two statements for consistency
 */
export async function compareStatements(statement1, statement2, options = {}) {
  if (!anthropic && !openai) {
    throw new Error('AI provider required for comparison');
  }

  const prompt = `Compare these two statements for consistency:

STATEMENT 1: "${statement1}"
STATEMENT 2: "${statement2}"

Assess:
1. Are they CONSISTENT, CONTRADICTORY, or UNRELATED?
2. What are the key differences?
3. Which is more likely accurate (if contradictory)?
4. Confidence in assessment?

Return JSON:
{
  "relationship": "CONSISTENT" | "CONTRADICTORY" | "PARTIALLY_CONSISTENT" | "UNRELATED",
  "differences": ["difference1", "difference2"],
  "moreAccurate": 1 | 2 | "neither" | "both",
  "confidence": 0-100,
  "reasoning": "explanation"
}`;

  let response;
  if (anthropic) {
    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });
    response = result.content[0].text;
  } else {
    const result = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    response = result.choices[0].message.content;
  }

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return {
        statement1,
        statement2,
        ...JSON.parse(jsonMatch[0])
      };
    }
  } catch (e) {
    // Fallback
  }

  return {
    statement1,
    statement2,
    relationship: 'UNKNOWN',
    confidence: 0
  };
}

// ============================================================================
// HISTORY & ANALYTICS
// ============================================================================

/**
 * Get verification history
 */
export function getVerificationHistory(limit = 50) {
  return verificationHistory.slice(-limit);
}

/**
 * Get verification statistics
 */
export function getVerificationStats() {
  if (verificationHistory.length === 0) {
    return { message: 'No verification history yet' };
  }

  const verdicts = {};
  let totalTime = 0;
  let totalConfidence = 0;

  verificationHistory.forEach(v => {
    verdicts[v.verdict] = (verdicts[v.verdict] || 0) + 1;
    totalTime += v.timeMs || 0;
    totalConfidence += v.confidence || 0;
  });

  return {
    totalVerifications: verificationHistory.length,
    verdictBreakdown: verdicts,
    verificationRate: `${Math.round(verdicts.VERIFIED / verificationHistory.length * 100 || 0)}%`,
    averageConfidence: (totalConfidence / verificationHistory.length).toFixed(2),
    averageTimeMs: Math.round(totalTime / verificationHistory.length)
  };
}

/**
 * Clear verification history
 */
export function clearHistory() {
  verificationHistory.length = 0;
  return { success: true, message: 'Verification history cleared' };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Core verification
  verify,
  quickVerify,
  deepVerify,
  // Batch operations
  verifyBatch,
  extractAndVerify,
  // Comparison
  compareStatements,
  // History
  getVerificationHistory,
  getVerificationStats,
  clearHistory
};
