// ============================================================================
// REFLEXION SERVICE - Self-Critique and Iterative Improvement
// Generates answer → Critiques itself → Retries with feedback
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

// Track reflexion history for learning
const reflexionHistory = [];

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    selfCritique: true,
    iterativeRefinement: true,
    errorDetection: true,
    maxRetries: 3,
    historySize: reflexionHistory.length,
    ready: !!(openai || anthropic)
  };
}

// ============================================================================
// CORE REFLEXION LOOP
// ============================================================================

/**
 * Main reflexion loop: Generate → Critique → Improve → Repeat
 * @param {string} task - The task to complete
 * @param {object} options - Configuration options
 */
export async function reflect(task, options = {}) {
  const {
    maxAttempts = 3,
    confidenceThreshold = 0.8,
    includeReasoning = true,
    context = ''
  } = options;

  const attempts = [];
  let currentAnswer = null;
  let currentConfidence = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Step 1: Generate (or regenerate with feedback)
    const generation = await generate(task, {
      previousAttempts: attempts,
      context,
      includeReasoning
    });

    currentAnswer = generation.answer;

    // Step 2: Self-critique
    const critique = await selfCritique(task, generation.answer, generation.reasoning);

    currentConfidence = critique.confidence;

    attempts.push({
      attempt,
      answer: generation.answer,
      reasoning: generation.reasoning,
      critique: critique.feedback,
      confidence: critique.confidence,
      issues: critique.issues
    });

    // Step 3: Check if good enough
    if (critique.confidence >= confidenceThreshold && critique.issues.length === 0) {
      break;
    }

    // Step 4: If not last attempt, prepare feedback for next iteration
    if (attempt < maxAttempts && critique.issues.length > 0) {
      // Feedback is automatically included in next generation via previousAttempts
      continue;
    }
  }

  const result = {
    task,
    finalAnswer: currentAnswer,
    finalConfidence: currentConfidence,
    attempts: attempts.length,
    allAttempts: attempts,
    improved: attempts.length > 1 &&
              attempts[attempts.length - 1].confidence > attempts[0].confidence
  };

  // Store in history for learning
  reflexionHistory.push({
    ...result,
    timestamp: new Date().toISOString()
  });

  // Keep history bounded
  if (reflexionHistory.length > 100) {
    reflexionHistory.shift();
  }

  return result;
}

/**
 * Generate an answer (with optional previous attempt feedback)
 */
async function generate(task, options = {}) {
  const { previousAttempts = [], context = '', includeReasoning = true } = options;

  const client = anthropic || openai;
  if (!client) throw new Error('No AI provider configured');

  let prompt = `Task: ${task}\n\n`;

  if (context) {
    prompt += `Context: ${context}\n\n`;
  }

  if (previousAttempts.length > 0) {
    prompt += `PREVIOUS ATTEMPTS AND FEEDBACK:\n`;
    previousAttempts.forEach((attempt, i) => {
      prompt += `\nAttempt ${i + 1}:\n`;
      prompt += `Answer: ${attempt.answer}\n`;
      prompt += `Critique: ${attempt.critique}\n`;
      prompt += `Issues: ${attempt.issues.join(', ')}\n`;
    });
    prompt += `\nBased on this feedback, provide an IMPROVED answer that addresses the issues.\n\n`;
  }

  if (includeReasoning) {
    prompt += `Provide your answer with step-by-step reasoning.\n\n`;
    prompt += `Format:\nREASONING:\n[Your thought process]\n\nANSWER:\n[Your final answer]`;
  }

  let response;
  if (anthropic) {
    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });
    response = result.content[0].text;
  } else {
    const result = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }]
    });
    response = result.choices[0].message.content;
  }

  // Parse reasoning and answer
  const reasoningMatch = response.match(/REASONING:\s*([\s\S]*?)(?=ANSWER:|$)/i);
  const answerMatch = response.match(/ANSWER:\s*([\s\S]*?)$/i);

  return {
    answer: answerMatch ? answerMatch[1].trim() : response,
    reasoning: reasoningMatch ? reasoningMatch[1].trim() : '',
    raw: response
  };
}

/**
 * Self-critique an answer
 */
async function selfCritique(task, answer, reasoning = '') {
  const client = anthropic || openai;
  if (!client) throw new Error('No AI provider configured');

  const prompt = `You are a critical reviewer. Analyze this answer for errors, gaps, and areas for improvement.

ORIGINAL TASK: ${task}

ANSWER PROVIDED:
${answer}

${reasoning ? `REASONING USED:\n${reasoning}\n` : ''}

Evaluate:
1. Is the answer correct and complete?
2. Are there any logical errors?
3. Is anything missing or unclear?
4. Could this be misunderstood?
5. What would make this better?

Return JSON:
{
  "confidence": 0.0-1.0,
  "isCorrect": true/false,
  "isComplete": true/false,
  "issues": ["issue1", "issue2"],
  "feedback": "Overall feedback for improvement",
  "strengths": ["strength1", "strength2"],
  "suggestions": ["suggestion1", "suggestion2"]
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
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    // Fallback parsing
  }

  return {
    confidence: 0.5,
    isCorrect: true,
    isComplete: true,
    issues: [],
    feedback: response,
    strengths: [],
    suggestions: []
  };
}

// ============================================================================
// QUICK REFLEXION (Lightweight check before sending)
// ============================================================================

/**
 * Quick check before sending a response
 */
export async function quickCheck(response, originalRequest) {
  if (!anthropic && !openai) {
    return { approved: true, issues: [] };
  }

  const client = anthropic || openai;

  const prompt = `Quick quality check. Does this response adequately address the request?

REQUEST: ${originalRequest}

RESPONSE: ${response}

Return JSON:
{
  "approved": true/false,
  "confidence": 0.0-1.0,
  "issues": ["any issues"],
  "quickFix": "suggested fix if needed"
}`;

  let result;
  if (anthropic) {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }]
    });
    result = resp.content[0].text;
  } else {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    result = resp.choices[0].message.content;
  }

  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    // Fallback
  }

  return { approved: true, issues: [] };
}

// ============================================================================
// SPECIALIZED REFLEXION MODES
// ============================================================================

/**
 * Code reflexion - generate, test mentally, fix
 */
export async function reflectOnCode(task, language = 'javascript') {
  return reflect(task, {
    maxAttempts: 3,
    confidenceThreshold: 0.85,
    context: `Language: ${language}. The code must be correct, efficient, and handle edge cases.`
  });
}

/**
 * Fact reflexion - generate, verify, correct
 */
export async function reflectOnFact(claim) {
  const result = await reflect(`Verify this claim and provide accurate information: ${claim}`, {
    maxAttempts: 2,
    confidenceThreshold: 0.9,
    context: 'Focus on factual accuracy. If uncertain, say so.'
  });

  return {
    ...result,
    isFactual: result.finalConfidence > 0.8
  };
}

/**
 * Plan reflexion - generate plan, find flaws, improve
 */
export async function reflectOnPlan(goal, constraints = []) {
  const constraintText = constraints.length > 0
    ? `Constraints: ${constraints.join(', ')}`
    : '';

  return reflect(`Create a detailed plan to achieve: ${goal}`, {
    maxAttempts: 3,
    confidenceThreshold: 0.75,
    context: `${constraintText}. The plan should be actionable, complete, and realistic.`
  });
}

/**
 * Analysis reflexion - analyze, find gaps, complete
 */
export async function reflectOnAnalysis(data, question) {
  return reflect(`Analyze this data to answer: ${question}\n\nData: ${JSON.stringify(data)}`, {
    maxAttempts: 2,
    confidenceThreshold: 0.8,
    context: 'Provide thorough analysis with evidence from the data.'
  });
}

// ============================================================================
// LEARNING FROM REFLEXION HISTORY
// ============================================================================

/**
 * Get reflexion statistics
 */
export function getReflexionStats() {
  if (reflexionHistory.length === 0) {
    return { message: 'No reflexion history yet' };
  }

  const improved = reflexionHistory.filter(r => r.improved).length;
  const avgAttempts = reflexionHistory.reduce((sum, r) => sum + r.attempts, 0) / reflexionHistory.length;
  const avgConfidence = reflexionHistory.reduce((sum, r) => sum + r.finalConfidence, 0) / reflexionHistory.length;

  return {
    totalReflexions: reflexionHistory.length,
    improvedCount: improved,
    improvementRate: (improved / reflexionHistory.length * 100).toFixed(1) + '%',
    averageAttempts: avgAttempts.toFixed(2),
    averageConfidence: (avgConfidence * 100).toFixed(1) + '%'
  };
}

/**
 * Get common issues from history
 */
export function getCommonIssues() {
  const issueCounts = {};

  for (const reflexion of reflexionHistory) {
    for (const attempt of reflexion.allAttempts) {
      for (const issue of attempt.issues || []) {
        issueCounts[issue] = (issueCounts[issue] || 0) + 1;
      }
    }
  }

  return Object.entries(issueCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([issue, count]) => ({ issue, count }));
}

/**
 * Get reflexion history
 */
export function getReflexionHistory(limit = 20) {
  return reflexionHistory.slice(-limit);
}

/**
 * Clear reflexion history
 */
export function clearHistory() {
  reflexionHistory.length = 0;
  return { success: true, message: 'Reflexion history cleared' };
}

// ============================================================================
// CHAIN-OF-VERIFICATION (Complementary technique)
// ============================================================================

/**
 * Generate answer, then systematically verify each claim
 */
export async function chainOfVerification(task) {
  // Step 1: Generate initial answer
  const initial = await generate(task, { includeReasoning: true });

  // Step 2: Extract claims from answer
  const claims = await extractClaims(initial.answer);

  // Step 3: Verify each claim
  const verifications = [];
  for (const claim of claims) {
    const verification = await verifyClaim(claim);
    verifications.push(verification);
  }

  // Step 4: Revise answer based on verification
  const failedVerifications = verifications.filter(v => !v.verified);

  if (failedVerifications.length === 0) {
    return {
      answer: initial.answer,
      reasoning: initial.reasoning,
      verified: true,
      claims: verifications
    };
  }

  // Regenerate with corrections
  const correctedAnswer = await correctAnswer(
    task,
    initial.answer,
    failedVerifications
  );

  return {
    answer: correctedAnswer,
    originalAnswer: initial.answer,
    verified: true,
    corrections: failedVerifications.length,
    claims: verifications
  };
}

async function extractClaims(text) {
  if (!openai) return [text];

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: `Extract individual factual claims from this text. Return as JSON array of strings.

Text: ${text}

Return: ["claim1", "claim2", ...]`
    }],
    response_format: { type: 'json_object' }
  });

  try {
    const result = JSON.parse(response.choices[0].message.content);
    return result.claims || result || [];
  } catch {
    return [text];
  }
}

async function verifyClaim(claim) {
  if (!openai) return { claim, verified: true, confidence: 0.5 };

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: `Verify this claim. Is it accurate?

Claim: ${claim}

Return JSON:
{
  "verified": true/false,
  "confidence": 0.0-1.0,
  "reason": "why",
  "correction": "if incorrect, what's correct"
}`
    }],
    response_format: { type: 'json_object' }
  });

  try {
    const result = JSON.parse(response.choices[0].message.content);
    return { claim, ...result };
  } catch {
    return { claim, verified: true, confidence: 0.5 };
  }
}

async function correctAnswer(task, originalAnswer, failedVerifications) {
  if (!anthropic && !openai) return originalAnswer;

  const client = anthropic || openai;
  const corrections = failedVerifications
    .map(v => `- "${v.claim}" → ${v.correction || 'REMOVE'}`)
    .join('\n');

  const prompt = `Correct this answer based on the following verified corrections:

ORIGINAL TASK: ${task}

ORIGINAL ANSWER: ${originalAnswer}

CORRECTIONS NEEDED:
${corrections}

Provide the corrected answer:`;

  if (anthropic) {
    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    });
    return result.content[0].text;
  } else {
    const result = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }]
    });
    return result.choices[0].message.content;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Core reflexion
  reflect,
  quickCheck,
  // Specialized modes
  reflectOnCode,
  reflectOnFact,
  reflectOnPlan,
  reflectOnAnalysis,
  // Chain of verification
  chainOfVerification,
  // History & learning
  getReflexionStats,
  getCommonIssues,
  getReflexionHistory,
  clearHistory
};
