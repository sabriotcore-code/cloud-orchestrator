// ============================================================================
// PROBABILISTIC REASONING SERVICE
// Bayesian inference, counterfactual analysis, uncertainty quantification
// ============================================================================

import OpenAI from 'openai';

// ============================================================================
// CONFIGURATION
// ============================================================================

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    bayesian: true,
    counterfactual: true,
    monteCarlo: true,
    ready: true
  };
}

// ============================================================================
// BAYESIAN INFERENCE
// ============================================================================

/**
 * Calculate Bayes' theorem
 * P(A|B) = P(B|A) * P(A) / P(B)
 *
 * @param {number} priorA - P(A) - prior probability of A
 * @param {number} likelihoodBgivenA - P(B|A) - likelihood of B given A
 * @param {number} priorB - P(B) - prior probability of B (evidence)
 */
export function bayesTheorem(priorA, likelihoodBgivenA, priorB) {
  if (priorB === 0) {
    return { error: 'P(B) cannot be zero' };
  }

  const posterior = (likelihoodBgivenA * priorA) / priorB;

  return {
    prior: priorA,
    likelihood: likelihoodBgivenA,
    evidence: priorB,
    posterior,
    formula: 'P(A|B) = P(B|A) × P(A) / P(B)',
    interpretation: `Given evidence B, the probability of A is ${(posterior * 100).toFixed(2)}%`
  };
}

/**
 * Calculate posterior with complement (more practical form)
 * P(A|B) = P(B|A) × P(A) / [P(B|A) × P(A) + P(B|¬A) × P(¬A)]
 *
 * @param {number} priorA - P(A) - prior probability
 * @param {number} likelihoodBgivenA - P(B|A) - true positive rate
 * @param {number} likelihoodBgivenNotA - P(B|¬A) - false positive rate
 */
export function bayesWithComplement(priorA, likelihoodBgivenA, likelihoodBgivenNotA) {
  const priorNotA = 1 - priorA;
  const evidence = (likelihoodBgivenA * priorA) + (likelihoodBgivenNotA * priorNotA);
  const posterior = (likelihoodBgivenA * priorA) / evidence;

  return {
    prior: priorA,
    truePositiveRate: likelihoodBgivenA,
    falsePositiveRate: likelihoodBgivenNotA,
    evidence,
    posterior,
    posteriorPercent: `${(posterior * 100).toFixed(2)}%`,
    interpretation: `Updated probability of A given B: ${(posterior * 100).toFixed(2)}%`
  };
}

/**
 * Bayesian network node
 */
class BayesianNode {
  constructor(name, parents = [], cpt = {}) {
    this.name = name;
    this.parents = parents;
    this.cpt = cpt; // Conditional probability table
  }

  getProbability(parentValues = {}) {
    if (this.parents.length === 0) {
      return this.cpt.prior || 0.5;
    }

    const key = this.parents.map(p => parentValues[p] ? 'T' : 'F').join('');
    return this.cpt[key] || 0.5;
  }
}

/**
 * Simple Bayesian network
 */
export class BayesianNetwork {
  constructor() {
    this.nodes = new Map();
  }

  addNode(name, parents = [], cpt = {}) {
    this.nodes.set(name, new BayesianNode(name, parents, cpt));
    return this;
  }

  /**
   * Query the network using enumeration
   * @param {string} queryVar - Variable to query
   * @param {object} evidence - Observed variables
   */
  query(queryVar, evidence = {}) {
    // Simple enumeration for small networks
    const allVars = Array.from(this.nodes.keys());
    const hiddenVars = allVars.filter(v => v !== queryVar && !(v in evidence));

    let probTrue = 0;
    let probFalse = 0;

    // Enumerate all combinations of hidden variables
    const numCombinations = Math.pow(2, hiddenVars.length);

    for (let i = 0; i < numCombinations; i++) {
      const assignment = { ...evidence };

      // Set hidden variable values for this combination
      hiddenVars.forEach((v, idx) => {
        assignment[v] = !!(i & (1 << idx));
      });

      // Calculate joint probability for query=true
      assignment[queryVar] = true;
      probTrue += this.jointProbability(assignment);

      // Calculate joint probability for query=false
      assignment[queryVar] = false;
      probFalse += this.jointProbability(assignment);
    }

    // Normalize
    const total = probTrue + probFalse;
    return {
      variable: queryVar,
      evidence,
      probabilityTrue: probTrue / total,
      probabilityFalse: probFalse / total
    };
  }

  jointProbability(assignment) {
    let prob = 1;
    for (const [name, node] of this.nodes) {
      const parentValues = {};
      for (const parent of node.parents) {
        parentValues[parent] = assignment[parent];
      }
      const condProb = node.getProbability(parentValues);
      prob *= assignment[name] ? condProb : (1 - condProb);
    }
    return prob;
  }
}

/**
 * Create a simple Bayesian network for common scenarios
 */
export function createBayesianNetwork(type = 'custom') {
  const network = new BayesianNetwork();

  if (type === 'diagnostic') {
    // Disease diagnosis network
    network
      .addNode('Disease', [], { prior: 0.01 })
      .addNode('Test', ['Disease'], { 'T': 0.95, 'F': 0.05 });
  } else if (type === 'causal') {
    // Simple causal chain
    network
      .addNode('Cause', [], { prior: 0.3 })
      .addNode('Mediator', ['Cause'], { 'T': 0.8, 'F': 0.2 })
      .addNode('Effect', ['Mediator'], { 'T': 0.9, 'F': 0.1 });
  }

  return network;
}

// ============================================================================
// COUNTERFACTUAL REASONING
// ============================================================================

/**
 * Analyze a counterfactual scenario
 * @param {string} factual - What actually happened
 * @param {string} counterfactual - What we're considering instead
 * @param {string} context - Relevant context/background
 */
export async function analyzeCounterfactual(factual, counterfactual, context = '') {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are an expert in counterfactual reasoning and causal inference. Analyze "what-if" scenarios rigorously.

Consider:
1. Causal mechanisms that would change
2. Downstream effects
3. Probability of alternative outcomes
4. Key assumptions`
      },
      {
        role: 'user',
        content: `Analyze this counterfactual:

WHAT ACTUALLY HAPPENED:
${factual}

WHAT IF INSTEAD:
${counterfactual}

${context ? `CONTEXT:\n${context}` : ''}

Provide:
1. Most likely alternative outcome
2. Probability estimate of that outcome (low/medium/high with %)
3. Key causal pathways affected
4. Unintended consequences
5. Critical assumptions in this analysis`
      }
    ]
  });

  return {
    factual,
    counterfactual,
    analysis: response.choices[0].message.content
  };
}

/**
 * Compare multiple counterfactual scenarios
 */
export async function compareCounterfactuals(factual, alternatives) {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: `Compare these alternative scenarios:

WHAT ACTUALLY HAPPENED:
${factual}

ALTERNATIVE SCENARIOS:
${alternatives.map((a, i) => `${i + 1}. ${a}`).join('\n')}

For each alternative:
1. Likelihood of success (1-10)
2. Key differences in outcome
3. Risks and benefits
4. Recommendation ranking`
      }
    ]
  });

  return {
    factual,
    alternatives,
    comparison: response.choices[0].message.content
  };
}

// ============================================================================
// MONTE CARLO SIMULATION
// ============================================================================

/**
 * Run Monte Carlo simulation
 * @param {function} simulationFn - Function that returns a single trial result
 * @param {number} trials - Number of trials to run
 */
export function monteCarloSimulation(simulationFn, trials = 10000) {
  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < trials; i++) {
    results.push(simulationFn());
  }

  const elapsed = Date.now() - startTime;

  // Calculate statistics
  const sum = results.reduce((a, b) => a + b, 0);
  const mean = sum / trials;
  const sortedResults = [...results].sort((a, b) => a - b);
  const median = sortedResults[Math.floor(trials / 2)];
  const variance = results.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / trials;
  const stdDev = Math.sqrt(variance);

  // Percentiles
  const p5 = sortedResults[Math.floor(trials * 0.05)];
  const p25 = sortedResults[Math.floor(trials * 0.25)];
  const p75 = sortedResults[Math.floor(trials * 0.75)];
  const p95 = sortedResults[Math.floor(trials * 0.95)];

  return {
    trials,
    elapsedMs: elapsed,
    statistics: {
      mean,
      median,
      stdDev,
      variance,
      min: sortedResults[0],
      max: sortedResults[trials - 1]
    },
    percentiles: {
      p5, p25, p50: median, p75, p95
    },
    confidenceInterval95: [p5, p95]
  };
}

/**
 * Estimate probability via Monte Carlo
 * @param {function} eventFn - Function that returns true/false for event
 * @param {number} trials - Number of trials
 */
export function estimateProbability(eventFn, trials = 10000) {
  let successes = 0;

  for (let i = 0; i < trials; i++) {
    if (eventFn()) successes++;
  }

  const probability = successes / trials;
  const standardError = Math.sqrt((probability * (1 - probability)) / trials);

  return {
    probability,
    probabilityPercent: `${(probability * 100).toFixed(2)}%`,
    successes,
    trials,
    standardError,
    confidenceInterval95: [
      Math.max(0, probability - 1.96 * standardError),
      Math.min(1, probability + 1.96 * standardError)
    ]
  };
}

// ============================================================================
// UNCERTAINTY QUANTIFICATION
// ============================================================================

/**
 * Quantify uncertainty in an estimate
 * @param {number[]} samples - Sample data
 */
export function quantifyUncertainty(samples) {
  const n = samples.length;
  if (n === 0) return { error: 'No samples provided' };

  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const variance = samples.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / (n - 1);
  const stdDev = Math.sqrt(variance);
  const stdError = stdDev / Math.sqrt(n);

  // Confidence intervals
  const t95 = 1.96; // Approximate for large n
  const ci95 = [mean - t95 * stdError, mean + t95 * stdError];
  const ci99 = [mean - 2.576 * stdError, mean + 2.576 * stdError];

  // Coefficient of variation
  const cv = (stdDev / mean) * 100;

  return {
    sampleSize: n,
    mean,
    median: sorted[Math.floor(n / 2)],
    standardDeviation: stdDev,
    standardError: stdError,
    coefficientOfVariation: `${cv.toFixed(2)}%`,
    confidenceInterval95: ci95,
    confidenceInterval99: ci99,
    range: [sorted[0], sorted[n - 1]],
    iqr: [sorted[Math.floor(n * 0.25)], sorted[Math.floor(n * 0.75)]]
  };
}

/**
 * Propagate uncertainty through a function
 * Uses Monte Carlo error propagation
 */
export function propagateUncertainty(fn, inputs, trials = 10000) {
  // inputs: [{mean, stdDev}]
  const results = [];

  for (let i = 0; i < trials; i++) {
    // Sample from each input distribution (assuming normal)
    const sampledInputs = inputs.map(input => {
      // Box-Muller transform for normal distribution
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return input.mean + z * input.stdDev;
    });

    results.push(fn(...sampledInputs));
  }

  return quantifyUncertainty(results);
}

// ============================================================================
// DECISION THEORY
// ============================================================================

/**
 * Expected value calculation for decisions
 * @param {object[]} options - [{name, outcomes: [{probability, value}]}]
 */
export function expectedValueAnalysis(options) {
  const results = options.map(option => {
    const ev = option.outcomes.reduce((sum, o) => sum + o.probability * o.value, 0);
    const variance = option.outcomes.reduce((sum, o) =>
      sum + o.probability * Math.pow(o.value - ev, 2), 0);

    return {
      option: option.name,
      expectedValue: ev,
      variance,
      standardDeviation: Math.sqrt(variance),
      bestCase: Math.max(...option.outcomes.map(o => o.value)),
      worstCase: Math.min(...option.outcomes.map(o => o.value))
    };
  });

  // Rank by expected value
  results.sort((a, b) => b.expectedValue - a.expectedValue);

  return {
    analysis: results,
    recommendation: results[0].option,
    evDifference: results.length > 1
      ? results[0].expectedValue - results[1].expectedValue
      : null
  };
}

/**
 * Risk-adjusted decision analysis
 */
export function riskAdjustedAnalysis(options, riskAversion = 0.5) {
  // Uses certainty equivalent with risk aversion
  // CE = E[X] - 0.5 * λ * Var[X]

  const results = options.map(option => {
    const ev = option.outcomes.reduce((sum, o) => sum + o.probability * o.value, 0);
    const variance = option.outcomes.reduce((sum, o) =>
      sum + o.probability * Math.pow(o.value - ev, 2), 0);

    const certaintyEquivalent = ev - 0.5 * riskAversion * variance;

    return {
      option: option.name,
      expectedValue: ev,
      variance,
      certaintyEquivalent,
      riskPremium: ev - certaintyEquivalent
    };
  });

  results.sort((a, b) => b.certaintyEquivalent - a.certaintyEquivalent);

  return {
    riskAversion,
    analysis: results,
    recommendation: results[0].option
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Bayesian
  bayesTheorem,
  bayesWithComplement,
  BayesianNetwork,
  createBayesianNetwork,
  // Counterfactual
  analyzeCounterfactual,
  compareCounterfactuals,
  // Monte Carlo
  monteCarloSimulation,
  estimateProbability,
  // Uncertainty
  quantifyUncertainty,
  propagateUncertainty,
  // Decision theory
  expectedValueAnalysis,
  riskAdjustedAnalysis
};
