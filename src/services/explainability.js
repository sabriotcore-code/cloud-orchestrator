// ============================================================================
// EXPLAINABILITY SERVICE (XAI)
// Decision transparency, reasoning chains, feature importance
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

// Store explanation history
const explanationHistory = [];

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    reasoningChains: true,
    featureImportance: true,
    counterfactualExplanations: true,
    decisionAudit: true,
    historySize: explanationHistory.length,
    ready: !!(openai || anthropic)
  };
}

// ============================================================================
// REASONING CHAIN EXPLANATIONS
// ============================================================================

/**
 * Generate step-by-step reasoning for a decision
 * @param {string} question - The question/task
 * @param {string} answer - The answer/decision made
 * @param {string} context - Additional context
 */
export async function explainReasoning(question, answer, context = '') {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are an explainability expert. Break down reasoning into clear, logical steps.
Make the thought process transparent and auditable.`
      },
      {
        role: 'user',
        content: `Explain the reasoning behind this decision:

QUESTION/TASK: ${question}

ANSWER/DECISION: ${answer}

${context ? `CONTEXT: ${context}` : ''}

Provide:
1. Initial understanding of the problem
2. Key information identified
3. Reasoning steps (numbered)
4. Assumptions made
5. Alternative approaches considered
6. Why this answer was chosen
7. Confidence level and why`
      }
    ]
  });

  const explanation = {
    id: `exp_${Date.now()}`,
    question,
    answer,
    explanation: response.choices[0].message.content,
    timestamp: new Date().toISOString()
  };

  explanationHistory.push(explanation);

  return explanation;
}

/**
 * Generate chain-of-thought explanation
 */
export async function chainOfThought(problem) {
  if (!anthropic) throw new Error('Anthropic API not configured');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `Solve this problem step-by-step, showing your complete thought process:

${problem}

Format your response as:
UNDERSTANDING: [What am I being asked?]
APPROACH: [How will I solve this?]
STEP 1: [First step with reasoning]
STEP 2: [Second step with reasoning]
...
VERIFICATION: [Check the answer]
FINAL ANSWER: [The solution]
CONFIDENCE: [How sure am I and why?]`
    }]
  });

  return {
    problem,
    chainOfThought: response.content[0].text
  };
}

// ============================================================================
// FEATURE IMPORTANCE (for structured decisions)
// ============================================================================

/**
 * Analyze which factors contributed to a decision
 * @param {object} features - Input features
 * @param {string} decision - The decision made
 * @param {object} options - Analysis options
 */
export async function analyzeFeatureImportance(features, decision, options = {}) {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are an expert at analyzing decision factors.
Identify which features/factors most influenced a decision and quantify their importance.`
      },
      {
        role: 'user',
        content: `Analyze which factors influenced this decision:

INPUT FEATURES:
${JSON.stringify(features, null, 2)}

DECISION MADE: ${decision}

For each feature:
1. Importance score (0-100)
2. Direction of influence (+/-)
3. How it affected the decision
4. What value would change the decision

Return as JSON with structure:
{
  "featureImportance": [
    {"feature": "...", "importance": 0-100, "direction": "+/-", "explanation": "..."}
  ],
  "topFactors": ["most important", "second most", "third most"],
  "decisionSensitivity": "low/medium/high"
}`
      }
    ],
    response_format: { type: 'json_object' }
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * SHAP-like explanation (simplified)
 */
export async function shapExplanation(features, prediction, baseline = null) {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: `Provide a SHAP-style explanation for this prediction:

FEATURES: ${JSON.stringify(features)}
PREDICTION: ${prediction}
${baseline ? `BASELINE: ${baseline}` : ''}

For each feature, explain:
1. Its contribution to the prediction (+ or -)
2. Magnitude of contribution (low/medium/high)
3. What changing it would do

Format as a breakdown showing how features combine to produce the prediction.`
      }
    ]
  });

  return {
    features,
    prediction,
    shapExplanation: response.choices[0].message.content
  };
}

// ============================================================================
// COUNTERFACTUAL EXPLANATIONS
// ============================================================================

/**
 * Generate counterfactual explanations
 * "What would need to change for a different outcome?"
 */
export async function generateCounterfactual(features, currentOutcome, desiredOutcome) {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Generate counterfactual explanations - identify minimal changes
that would lead to a different outcome.`
      },
      {
        role: 'user',
        content: `What would need to change?

CURRENT FEATURES:
${JSON.stringify(features, null, 2)}

CURRENT OUTCOME: ${currentOutcome}
DESIRED OUTCOME: ${desiredOutcome}

Identify:
1. Minimal changes needed (smallest set of feature changes)
2. Most actionable changes (easiest to implement)
3. Most impactful single change
4. Trade-offs of each change
5. Confidence that changes would work`
      }
    ]
  });

  return {
    currentOutcome,
    desiredOutcome,
    counterfactual: response.choices[0].message.content
  };
}

/**
 * "What if" scenario analysis
 */
export async function whatIfAnalysis(scenario, modifications) {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: `Analyze this "what if" scenario:

CURRENT SCENARIO:
${scenario}

PROPOSED MODIFICATIONS:
${modifications.map((m, i) => `${i + 1}. ${m}`).join('\n')}

For each modification:
1. Likely outcome
2. Probability of success
3. Risks and side effects
4. Dependencies on other factors
5. Recommended order of implementation`
      }
    ]
  });

  return {
    scenario,
    modifications,
    analysis: response.choices[0].message.content
  };
}

// ============================================================================
// DECISION AUDIT & TRANSPARENCY
// ============================================================================

/**
 * Create an audit trail for a decision
 */
export async function createDecisionAudit(decision, factors, stakeholders = []) {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'Create comprehensive, auditable decision documentation.'
      },
      {
        role: 'user',
        content: `Create an audit document for this decision:

DECISION: ${decision}

FACTORS CONSIDERED:
${JSON.stringify(factors, null, 2)}

${stakeholders.length > 0 ? `STAKEHOLDERS: ${stakeholders.join(', ')}` : ''}

Include:
1. Decision summary
2. Date and context
3. Factors analyzed (with weights)
4. Alternatives considered
5. Risks identified
6. Expected outcomes
7. Success metrics
8. Review timeline
9. Responsible parties
10. Audit trail metadata`
      }
    ]
  });

  const audit = {
    id: `audit_${Date.now()}`,
    decision,
    factors,
    stakeholders,
    auditDocument: response.choices[0].message.content,
    createdAt: new Date().toISOString()
  };

  return audit;
}

/**
 * Explain model behavior
 */
export async function explainModelBehavior(modelDescription, inputs, outputs) {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: `Explain this AI model's behavior:

MODEL: ${modelDescription}

SAMPLE INPUTS AND OUTPUTS:
${inputs.map((inp, i) => `Input ${i + 1}: ${JSON.stringify(inp)} → Output: ${outputs[i]}`).join('\n')}

Explain:
1. What patterns the model seems to follow
2. Apparent decision rules
3. Edge cases or anomalies
4. Potential biases
5. Reliability assessment
6. Recommendations for users`
      }
    ]
  });

  return {
    modelDescription,
    samplesAnalyzed: inputs.length,
    explanation: response.choices[0].message.content
  };
}

// ============================================================================
// CONFIDENCE & UNCERTAINTY COMMUNICATION
// ============================================================================

/**
 * Generate human-friendly uncertainty explanation
 */
export async function explainUncertainty(prediction, confidence, factors = []) {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: `Explain this prediction's uncertainty in plain language:

PREDICTION: ${prediction}
CONFIDENCE: ${confidence}%

${factors.length > 0 ? `UNCERTAINTY FACTORS:\n${factors.join('\n')}` : ''}

Provide:
1. Plain English interpretation of ${confidence}% confidence
2. What we're most sure about
3. What we're least sure about
4. What could change this prediction
5. Advice for decision-makers`
      }
    ]
  });

  return {
    prediction,
    confidence,
    uncertaintyExplanation: response.choices[0].message.content
  };
}

/**
 * Compare confidence across options
 */
export async function compareConfidence(options) {
  // options: [{name, prediction, confidence, factors}]

  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: `Compare confidence levels across these options:

${options.map(o => `
OPTION: ${o.name}
Prediction: ${o.prediction}
Confidence: ${o.confidence}%
Factors: ${o.factors?.join(', ') || 'N/A'}
`).join('\n---\n')}

Analyze:
1. Rank by confidence (most to least certain)
2. Why confidence differs
3. Which option has most reliable prediction
4. Risk-adjusted recommendation
5. What would increase confidence for each`
      }
    ]
  });

  return {
    options: options.map(o => o.name),
    comparison: response.choices[0].message.content
  };
}

// ============================================================================
// EXPLANATION FORMATS
// ============================================================================

/**
 * Generate explanation for different audiences
 */
export async function explainForAudience(decision, reasoning, audience = 'general') {
  if (!openai) throw new Error('OpenAI API not configured');

  const audienceInstructions = {
    general: 'Explain in simple, everyday language. Avoid jargon.',
    technical: 'Use precise technical language. Include methodology details.',
    executive: 'Focus on business impact and bottom line. Be concise.',
    regulatory: 'Emphasize compliance, risk management, and audit trail.',
    child: 'Use very simple words and analogies a 10-year-old would understand.'
  };

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: audienceInstructions[audience] || audienceInstructions.general
      },
      {
        role: 'user',
        content: `Explain this decision:

DECISION: ${decision}

REASONING: ${reasoning}

Tailor the explanation for a ${audience} audience.`
      }
    ]
  });

  return {
    decision,
    audience,
    explanation: response.choices[0].message.content
  };
}

/**
 * Generate visual explanation (text-based diagram)
 */
export async function visualExplanation(process, type = 'flowchart') {
  if (!openai) throw new Error('OpenAI API not configured');

  const diagramTypes = {
    flowchart: 'Create an ASCII flowchart showing the decision flow',
    tree: 'Create an ASCII decision tree',
    timeline: 'Create an ASCII timeline of events/steps',
    hierarchy: 'Create an ASCII hierarchy/org chart style diagram'
  };

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: `${diagramTypes[type]}

PROCESS TO VISUALIZE:
${process}

Create a clear, ASCII-based visual representation.
Use boxes, arrows, and clear labels.
Make it easy to follow the logic.`
      }
    ]
  });

  return {
    type,
    diagram: response.choices[0].message.content
  };
}

// ============================================================================
// EXPLANATION HISTORY & RETRIEVAL
// ============================================================================

/**
 * Get explanation history
 */
export function getExplanationHistory(limit = 20) {
  return {
    total: explanationHistory.length,
    explanations: explanationHistory.slice(-limit)
  };
}

/**
 * Search explanations
 */
export function searchExplanations(query) {
  const results = explanationHistory.filter(exp =>
    exp.question?.toLowerCase().includes(query.toLowerCase()) ||
    exp.answer?.toLowerCase().includes(query.toLowerCase()) ||
    exp.explanation?.toLowerCase().includes(query.toLowerCase())
  );

  return {
    query,
    resultCount: results.length,
    results
  };
}

/**
 * Clear explanation history
 */
export function clearExplanationHistory() {
  explanationHistory.length = 0;
  return { success: true, message: 'Explanation history cleared' };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Reasoning chains
  explainReasoning,
  chainOfThought,
  // Feature importance
  analyzeFeatureImportance,
  shapExplanation,
  // Counterfactual
  generateCounterfactual,
  whatIfAnalysis,
  // Audit
  createDecisionAudit,
  explainModelBehavior,
  // Uncertainty
  explainUncertainty,
  compareConfidence,
  // Formats
  explainForAudience,
  visualExplanation,
  // History
  getExplanationHistory,
  searchExplanations,
  clearExplanationHistory
};
