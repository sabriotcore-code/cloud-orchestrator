// ============================================================================
// TREE-OF-THOUGHT SERVICE - Parallel Reasoning with Backtracking
// Explore multiple reasoning paths, evaluate, prune, and find best solution
// ============================================================================

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ============================================================================
// CONFIGURATION
// ============================================================================

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

// Tree exploration history
const explorationHistory = [];

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    parallelBranches: true,
    backtracking: true,
    multiProvider: !!(openai && anthropic && gemini),
    providers: {
      openai: !!openai,
      anthropic: !!anthropic,
      gemini: !!gemini
    },
    explorationHistory: explorationHistory.length,
    ready: !!(openai || anthropic || gemini)
  };
}

// ============================================================================
// CORE TREE-OF-THOUGHT
// ============================================================================

/**
 * Main ToT exploration
 * @param {string} problem - The problem to solve
 * @param {object} options - Configuration
 */
export async function explore(problem, options = {}) {
  const {
    breadth = 3,           // Number of parallel branches
    depth = 3,             // Maximum depth of exploration
    evaluationThreshold = 0.6,  // Minimum score to continue branch
    useMultiProvider = true,    // Use different AIs for diversity
    pruneAggressive = false     // Prune low-scoring branches early
  } = options;

  const startTime = Date.now();

  // Initialize tree
  const tree = {
    problem,
    root: {
      id: 'root',
      thought: problem,
      children: [],
      score: 1.0,
      depth: 0
    }
  };

  // BFS exploration with evaluation
  let currentLevel = [tree.root];
  let bestPath = null;
  let bestScore = 0;

  for (let d = 0; d < depth; d++) {
    const nextLevel = [];

    // Explore each node in current level in parallel
    const expansions = await Promise.all(
      currentLevel
        .filter(node => node.score >= evaluationThreshold)
        .map(node => expandNode(node, problem, breadth, useMultiProvider))
    );

    // Flatten and evaluate children
    for (const children of expansions) {
      for (const child of children) {
        // Evaluate this thought
        const evaluation = await evaluateThought(problem, child.thought, child.path);
        child.score = evaluation.score;
        child.evaluation = evaluation;

        // Track best path
        if (child.isComplete && child.score > bestScore) {
          bestScore = child.score;
          bestPath = child;
        }

        // Add to next level if promising
        if (!child.isComplete && child.score >= evaluationThreshold) {
          nextLevel.push(child);
        }

        // Aggressive pruning
        if (pruneAggressive && nextLevel.length > breadth * 2) {
          nextLevel.sort((a, b) => b.score - a.score);
          nextLevel.length = breadth * 2;
        }
      }
    }

    currentLevel = nextLevel;

    // Early termination if we have a great solution
    if (bestScore > 0.95) break;

    // No more nodes to explore
    if (currentLevel.length === 0) break;
  }

  // If no complete solution found, take best partial
  if (!bestPath && currentLevel.length > 0) {
    currentLevel.sort((a, b) => b.score - a.score);
    bestPath = currentLevel[0];
  }

  const result = {
    problem,
    solution: bestPath?.thought || 'No solution found',
    confidence: bestScore,
    path: bestPath?.path || [],
    explorationStats: {
      depth: bestPath?.depth || 0,
      nodesExplored: countNodes(tree.root),
      timeMs: Date.now() - startTime
    }
  };

  // Store in history
  explorationHistory.push({
    ...result,
    timestamp: new Date().toISOString()
  });

  if (explorationHistory.length > 50) {
    explorationHistory.shift();
  }

  return result;
}

/**
 * Expand a node into multiple child thoughts
 */
async function expandNode(node, problem, breadth, useMultiProvider) {
  const children = [];

  // Generate diverse thoughts using different providers or prompts
  const generators = useMultiProvider
    ? [generateWithClaude, generateWithGPT, generateWithGemini].filter(Boolean)
    : [generateWithClaude || generateWithGPT || generateWithGemini].filter(Boolean);

  // If we have fewer generators than breadth, reuse with different prompts
  const tasks = [];
  for (let i = 0; i < breadth; i++) {
    const generator = generators[i % generators.length];
    if (generator) {
      tasks.push(generator(problem, node, i));
    }
  }

  const results = await Promise.allSettled(tasks);

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      children.push({
        id: `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        thought: result.value.thought,
        reasoning: result.value.reasoning,
        isComplete: result.value.isComplete,
        parent: node.id,
        path: [...(node.path || [node.thought]), result.value.thought],
        depth: node.depth + 1,
        score: 0,
        provider: result.value.provider
      });
    }
  }

  node.children = children;
  return children;
}

/**
 * Generate next thought with Claude
 */
async function generateWithClaude(problem, node, variant) {
  if (!anthropic) return null;

  const approaches = [
    'Think step by step, focusing on the logical progression.',
    'Consider this from a different angle - what assumptions might be wrong?',
    'Break this into smaller sub-problems and solve each.'
  ];

  const prompt = `Problem: ${problem}

Current thinking:
${node.path?.join('\n→ ') || node.thought}

${approaches[variant % approaches.length]}

Continue the reasoning. If you can reach a final answer, mark it as [COMPLETE].

Next thought:`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  });

  const thought = response.content[0].text;

  return {
    thought: thought.replace('[COMPLETE]', '').trim(),
    reasoning: '',
    isComplete: thought.includes('[COMPLETE]'),
    provider: 'claude'
  };
}

/**
 * Generate next thought with GPT
 */
async function generateWithGPT(problem, node, variant) {
  if (!openai) return null;

  const approaches = [
    'Approach this analytically with precise logic.',
    'Think creatively - what unconventional solution might work?',
    'Consider edge cases and potential pitfalls.'
  ];

  const prompt = `Problem: ${problem}

Current thinking:
${node.path?.join('\n→ ') || node.thought}

${approaches[variant % approaches.length]}

Continue the reasoning. If you can reach a final answer, mark it as [COMPLETE].

Next thought:`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1024
  });

  const thought = response.choices[0].message.content;

  return {
    thought: thought.replace('[COMPLETE]', '').trim(),
    reasoning: '',
    isComplete: thought.includes('[COMPLETE]'),
    provider: 'gpt'
  };
}

/**
 * Generate next thought with Gemini
 */
async function generateWithGemini(problem, node, variant) {
  if (!gemini) return null;

  const approaches = [
    'Use systematic reasoning to progress.',
    'What would an expert in this domain consider?',
    'Synthesize the information to reach a conclusion.'
  ];

  const prompt = `Problem: ${problem}

Current thinking:
${node.path?.join('\n→ ') || node.thought}

${approaches[variant % approaches.length]}

Continue the reasoning. If you can reach a final answer, mark it as [COMPLETE].

Next thought:`;

  try {
    const model = gemini.getGenerativeModel({ model: 'gemini-1.5-pro' });
    const result = await model.generateContent(prompt);
    const thought = result.response.text();

    return {
      thought: thought.replace('[COMPLETE]', '').trim(),
      reasoning: '',
      isComplete: thought.includes('[COMPLETE]'),
      provider: 'gemini'
    };
  } catch (e) {
    console.log('[ToT] Gemini generation failed:', e.message);
    return null;
  }
}

/**
 * Evaluate how promising a thought is
 */
async function evaluateThought(problem, thought, path = []) {
  if (!openai && !anthropic) {
    return { score: 0.5, reasoning: 'No evaluator available' };
  }

  const prompt = `Evaluate this reasoning step for solving the problem.

PROBLEM: ${problem}

REASONING PATH:
${path.join('\n→ ')}

CURRENT THOUGHT: ${thought}

Rate on these dimensions (0-10):
1. Progress: Does this move toward a solution?
2. Correctness: Is the reasoning logically sound?
3. Completeness: Does this fully answer the problem?
4. Clarity: Is the thought clear and actionable?

Return JSON:
{
  "progress": 0-10,
  "correctness": 0-10,
  "completeness": 0-10,
  "clarity": 0-10,
  "overallScore": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

  try {
    let response;
    if (openai) {
      const result = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      });
      response = result.choices[0].message.content;
    } else {
      const result = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }]
      });
      response = result.content[0].text;
    }

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const evaluation = JSON.parse(jsonMatch[0]);
      return {
        score: evaluation.overallScore || (
          (evaluation.progress + evaluation.correctness +
           evaluation.completeness + evaluation.clarity) / 40
        ),
        ...evaluation
      };
    }
  } catch (e) {
    console.log('[ToT] Evaluation failed:', e.message);
  }

  return { score: 0.5, reasoning: 'Evaluation failed' };
}

/**
 * Count nodes in tree
 */
function countNodes(node) {
  let count = 1;
  for (const child of node.children || []) {
    count += countNodes(child);
  }
  return count;
}

// ============================================================================
// SPECIALIZED ToT MODES
// ============================================================================

/**
 * ToT for mathematical problems
 */
export async function solveMath(problem) {
  return explore(problem, {
    breadth: 3,
    depth: 5,
    evaluationThreshold: 0.7,
    useMultiProvider: true
  });
}

/**
 * ToT for planning problems
 */
export async function createPlan(goal, constraints = []) {
  const problem = `Create a plan to: ${goal}${
    constraints.length > 0 ? `\nConstraints: ${constraints.join(', ')}` : ''
  }`;

  return explore(problem, {
    breadth: 4,
    depth: 4,
    evaluationThreshold: 0.6,
    useMultiProvider: true
  });
}

/**
 * ToT for debugging
 */
export async function debugProblem(issue, context = '') {
  const problem = `Debug this issue: ${issue}${context ? `\nContext: ${context}` : ''}`;

  return explore(problem, {
    breadth: 3,
    depth: 4,
    evaluationThreshold: 0.65,
    useMultiProvider: true
  });
}

/**
 * ToT for decision making
 */
export async function makeDecision(question, options = [], criteria = []) {
  let problem = `Decision: ${question}`;
  if (options.length > 0) {
    problem += `\nOptions: ${options.join(', ')}`;
  }
  if (criteria.length > 0) {
    problem += `\nCriteria: ${criteria.join(', ')}`;
  }

  return explore(problem, {
    breadth: options.length || 3,
    depth: 3,
    evaluationThreshold: 0.6,
    useMultiProvider: true
  });
}

// ============================================================================
// BEAM SEARCH VARIANT
// ============================================================================

/**
 * Beam search: Keep only top-k branches at each level
 */
export async function beamSearch(problem, beamWidth = 3, maxDepth = 4) {
  const startTime = Date.now();

  let beam = [{
    thought: problem,
    path: [problem],
    score: 1.0,
    depth: 0
  }];

  for (let d = 0; d < maxDepth; d++) {
    const allCandidates = [];

    // Expand all beams
    for (const node of beam) {
      const children = await expandNode(node, problem, 3, true);

      for (const child of children) {
        const evaluation = await evaluateThought(problem, child.thought, child.path);
        child.score = evaluation.score;
        allCandidates.push(child);
      }
    }

    // Keep top-k
    allCandidates.sort((a, b) => b.score - a.score);
    beam = allCandidates.slice(0, beamWidth);

    // Check for complete solutions
    const complete = beam.filter(n => n.isComplete);
    if (complete.length > 0) {
      return {
        problem,
        solution: complete[0].thought,
        confidence: complete[0].score,
        path: complete[0].path,
        method: 'beam_search',
        stats: {
          beamWidth,
          depth: d + 1,
          timeMs: Date.now() - startTime
        }
      };
    }

    if (beam.length === 0) break;
  }

  // Return best partial solution
  return {
    problem,
    solution: beam[0]?.thought || 'No solution found',
    confidence: beam[0]?.score || 0,
    path: beam[0]?.path || [],
    method: 'beam_search',
    stats: {
      beamWidth,
      depth: maxDepth,
      timeMs: Date.now() - startTime
    }
  };
}

// ============================================================================
// SELF-CONSISTENCY (Generate multiple, vote)
// ============================================================================

/**
 * Generate multiple solutions and vote on best
 */
export async function selfConsistency(problem, samples = 5) {
  const startTime = Date.now();

  // Generate multiple solutions in parallel
  const generators = [];
  for (let i = 0; i < samples; i++) {
    generators.push(generateSolution(problem, i));
  }

  const results = await Promise.allSettled(generators);
  const solutions = results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  if (solutions.length === 0) {
    return { error: 'No solutions generated' };
  }

  // Cluster similar answers and count
  const clusters = clusterSolutions(solutions);

  // Get majority answer
  clusters.sort((a, b) => b.count - a.count);
  const majority = clusters[0];

  return {
    problem,
    solution: majority.representative,
    confidence: majority.count / solutions.length,
    agreement: `${majority.count}/${solutions.length}`,
    allClusters: clusters.map(c => ({
      answer: c.representative.substring(0, 100),
      votes: c.count
    })),
    method: 'self_consistency',
    stats: {
      samples,
      clusters: clusters.length,
      timeMs: Date.now() - startTime
    }
  };
}

async function generateSolution(problem, variant) {
  const providers = [anthropic, openai, gemini].filter(Boolean);
  const provider = providers[variant % providers.length];

  if (!provider) return null;

  const prompt = `Solve this problem step by step, then provide your final answer.

Problem: ${problem}

Show your work, then end with:
FINAL ANSWER: [your answer]`;

  try {
    if (provider === anthropic) {
      const result = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      });
      return result.content[0].text;
    } else if (provider === openai) {
      const result = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }]
      });
      return result.choices[0].message.content;
    } else if (provider === gemini) {
      const model = gemini.getGenerativeModel({ model: 'gemini-1.5-pro' });
      const result = await model.generateContent(prompt);
      return result.response.text();
    }
  } catch (e) {
    console.log('[ToT] Generation failed:', e.message);
    return null;
  }
}

function clusterSolutions(solutions) {
  // Simple clustering based on final answer extraction
  const clusters = new Map();

  for (const solution of solutions) {
    // Extract final answer
    const answerMatch = solution.match(/FINAL ANSWER:\s*([\s\S]*?)(?:\n|$)/i);
    const answer = answerMatch
      ? answerMatch[1].trim().toLowerCase()
      : solution.substring(0, 100).toLowerCase();

    // Simple key (first 50 chars, normalized)
    const key = answer.substring(0, 50).replace(/\s+/g, ' ');

    if (clusters.has(key)) {
      clusters.get(key).count++;
    } else {
      clusters.set(key, {
        representative: solution,
        answer: answer,
        count: 1
      });
    }
  }

  return Array.from(clusters.values());
}

// ============================================================================
// HISTORY & STATS
// ============================================================================

/**
 * Get exploration statistics
 */
export function getExplorationStats() {
  if (explorationHistory.length === 0) {
    return { message: 'No explorations yet' };
  }

  const avgConfidence = explorationHistory.reduce((sum, e) => sum + e.confidence, 0) / explorationHistory.length;
  const avgTime = explorationHistory.reduce((sum, e) => sum + (e.explorationStats?.timeMs || 0), 0) / explorationHistory.length;

  return {
    totalExplorations: explorationHistory.length,
    averageConfidence: (avgConfidence * 100).toFixed(1) + '%',
    averageTimeMs: Math.round(avgTime),
    successRate: (explorationHistory.filter(e => e.confidence > 0.7).length / explorationHistory.length * 100).toFixed(1) + '%'
  };
}

/**
 * Get exploration history
 */
export function getExplorationHistory(limit = 20) {
  return explorationHistory.slice(-limit);
}

/**
 * Clear history
 */
export function clearHistory() {
  explorationHistory.length = 0;
  return { success: true, message: 'History cleared' };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Core ToT
  explore,
  // Specialized modes
  solveMath,
  createPlan,
  debugProblem,
  makeDecision,
  // Variants
  beamSearch,
  selfConsistency,
  // History
  getExplorationStats,
  getExplorationHistory,
  clearHistory
};
