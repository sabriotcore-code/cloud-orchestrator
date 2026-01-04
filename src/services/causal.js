/**
 * CAUSAL REASONING ENGINE
 *
 * Identify cause-effect relationships:
 * - Event correlation analysis
 * - Causal graph construction
 * - Root cause analysis
 * - Impact prediction
 * - Intervention simulation
 */

import * as db from '../db/index.js';
import * as aiProviders from './ai-providers.js';
import * as neo4j from './neo4j.js';

// ============================================================================
// CAUSAL GRAPH CONSTRUCTION
// ============================================================================

/**
 * Build causal graph from events/data
 */
export async function buildCausalGraph(events, options = {}) {
  const { timeWindow = 3600000, minConfidence = 0.5 } = options; // 1 hour window

  const graph = {
    nodes: new Map(),
    edges: [],
    metadata: { created: new Date().toISOString(), eventCount: events.length }
  };

  // Extract unique event types
  events.forEach(event => {
    const type = event.type || event.name || 'unknown';
    if (!graph.nodes.has(type)) {
      graph.nodes.set(type, {
        id: type,
        occurrences: 0,
        avgValue: 0,
        values: []
      });
    }
    const node = graph.nodes.get(type);
    node.occurrences++;
    if (event.value !== undefined) {
      node.values.push(event.value);
    }
  });

  // Calculate averages
  graph.nodes.forEach(node => {
    if (node.values.length > 0) {
      node.avgValue = node.values.reduce((a, b) => a + b, 0) / node.values.length;
    }
  });

  // Find temporal correlations (A followed by B within window)
  const sortedEvents = [...events].sort((a, b) =>
    new Date(a.timestamp || a.time || 0) - new Date(b.timestamp || b.time || 0)
  );

  const correlations = {};

  for (let i = 0; i < sortedEvents.length; i++) {
    const eventA = sortedEvents[i];
    const timeA = new Date(eventA.timestamp || eventA.time || 0).getTime();
    const typeA = eventA.type || eventA.name || 'unknown';

    for (let j = i + 1; j < sortedEvents.length; j++) {
      const eventB = sortedEvents[j];
      const timeB = new Date(eventB.timestamp || eventB.time || 0).getTime();
      const typeB = eventB.type || eventB.name || 'unknown';

      if (timeB - timeA > timeWindow) break;
      if (typeA === typeB) continue;

      const key = `${typeA}->${typeB}`;
      correlations[key] = (correlations[key] || 0) + 1;
    }
  }

  // Convert to edges with confidence
  const maxCorr = Math.max(...Object.values(correlations), 1);

  for (const [key, count] of Object.entries(correlations)) {
    const [from, to] = key.split('->');
    const confidence = count / maxCorr;

    if (confidence >= minConfidence) {
      graph.edges.push({
        from,
        to,
        weight: count,
        confidence,
        relationship: 'precedes'
      });
    }
  }

  return {
    nodes: Array.from(graph.nodes.values()),
    edges: graph.edges,
    metadata: graph.metadata
  };
}

/**
 * Store causal graph in Neo4j
 */
export async function storeCausalGraph(graph, graphName = 'default') {
  try {
    // Create nodes
    for (const node of graph.nodes) {
      await neo4j.createEntity('CausalEvent', {
        id: `${graphName}:${node.id}`,
        name: node.id,
        occurrences: node.occurrences,
        avgValue: node.avgValue,
        graph: graphName
      });
    }

    // Create edges
    for (const edge of graph.edges) {
      await neo4j.createRelationship(
        `${graphName}:${edge.from}`,
        `${graphName}:${edge.to}`,
        'CAUSES',
        { weight: edge.weight, confidence: edge.confidence }
      );
    }

    return { stored: true, nodes: graph.nodes.length, edges: graph.edges.length };
  } catch (e) {
    return { stored: false, error: e.message };
  }
}

// ============================================================================
// ROOT CAUSE ANALYSIS
// ============================================================================

/**
 * Find root causes for an effect
 */
export async function findRootCauses(effect, events, options = {}) {
  const { depth = 3, minConfidence = 0.3 } = options;

  // Build causal graph
  const graph = await buildCausalGraph(events, { minConfidence });

  // Find all paths leading to effect
  const causes = [];
  const visited = new Set();

  function traceback(node, path, currentDepth) {
    if (currentDepth > depth || visited.has(node)) return;
    visited.add(node);

    const incomingEdges = graph.edges.filter(e => e.to === node);

    for (const edge of incomingEdges) {
      const newPath = [{ node: edge.from, confidence: edge.confidence }, ...path];
      causes.push({
        rootCause: edge.from,
        path: newPath,
        totalConfidence: newPath.reduce((acc, p) => acc * p.confidence, 1)
      });
      traceback(edge.from, newPath, currentDepth + 1);
    }
  }

  traceback(effect, [], 0);

  // Sort by confidence and deduplicate
  const uniqueCauses = causes
    .sort((a, b) => b.totalConfidence - a.totalConfidence)
    .filter((cause, index, self) =>
      index === self.findIndex(c => c.rootCause === cause.rootCause)
    );

  return {
    effect,
    rootCauses: uniqueCauses.slice(0, 10),
    graphStats: { nodes: graph.nodes.length, edges: graph.edges.length }
  };
}

/**
 * AI-powered root cause analysis
 */
export async function analyzeRootCause(symptom, context = {}) {
  const prompt = `Perform root cause analysis for this symptom/problem:

Symptom: ${symptom}

Context:
${JSON.stringify(context, null, 2)}

Provide:
1. Most likely root causes (ranked by probability)
2. Evidence needed to confirm each cause
3. Recommended investigation steps
4. Quick fixes vs long-term solutions

Format as structured JSON.`;

  try {
    const response = await aiProviders.chat('claude', prompt);
    const parsed = JSON.parse(response.response.match(/\{[\s\S]*\}/)?.[0] || '{}');

    return {
      symptom,
      analysis: parsed,
      model: 'claude'
    };
  } catch (e) {
    return {
      symptom,
      error: e.message,
      analysis: { note: 'Failed to parse AI response', raw: e.message }
    };
  }
}

// ============================================================================
// IMPACT PREDICTION
// ============================================================================

/**
 * Predict downstream effects of an event
 */
export async function predictImpact(cause, events, options = {}) {
  const { depth = 3, minConfidence = 0.3 } = options;

  const graph = await buildCausalGraph(events, { minConfidence });

  const effects = [];
  const visited = new Set();

  function propagate(node, path, currentDepth, accumulatedConfidence) {
    if (currentDepth > depth || visited.has(node)) return;
    visited.add(node);

    const outgoingEdges = graph.edges.filter(e => e.from === node);

    for (const edge of outgoingEdges) {
      const newConfidence = accumulatedConfidence * edge.confidence;
      const newPath = [...path, { node: edge.to, confidence: edge.confidence }];

      effects.push({
        effect: edge.to,
        path: newPath,
        depth: currentDepth + 1,
        probability: newConfidence
      });

      propagate(edge.to, newPath, currentDepth + 1, newConfidence);
    }
  }

  propagate(cause, [], 0, 1);

  // Sort by probability
  const sortedEffects = effects
    .sort((a, b) => b.probability - a.probability)
    .filter((effect, index, self) =>
      index === self.findIndex(e => e.effect === effect.effect)
    );

  return {
    cause,
    predictedEffects: sortedEffects.slice(0, 15),
    totalPotentialEffects: sortedEffects.length,
    graphStats: { nodes: graph.nodes.length, edges: graph.edges.length }
  };
}

// ============================================================================
// INTERVENTION SIMULATION
// ============================================================================

/**
 * Simulate the effect of an intervention
 */
export async function simulateIntervention(intervention, events, options = {}) {
  const { targetNode, action = 'remove', value = null } = intervention;

  // Build baseline graph
  const baselineGraph = await buildCausalGraph(events);

  // Modify events based on intervention
  let modifiedEvents = [...events];

  if (action === 'remove') {
    modifiedEvents = events.filter(e => (e.type || e.name) !== targetNode);
  } else if (action === 'modify' && value !== null) {
    modifiedEvents = events.map(e => {
      if ((e.type || e.name) === targetNode) {
        return { ...e, value };
      }
      return e;
    });
  } else if (action === 'add') {
    modifiedEvents.push({
      type: targetNode,
      value: value || 1,
      timestamp: new Date().toISOString()
    });
  }

  // Build counterfactual graph
  const counterfactualGraph = await buildCausalGraph(modifiedEvents);

  // Compare graphs
  const removedEdges = baselineGraph.edges.filter(
    be => !counterfactualGraph.edges.some(ce => ce.from === be.from && ce.to === be.to)
  );

  const addedEdges = counterfactualGraph.edges.filter(
    ce => !baselineGraph.edges.some(be => be.from === ce.from && be.to === ce.to)
  );

  return {
    intervention,
    baseline: {
      nodes: baselineGraph.nodes.length,
      edges: baselineGraph.edges.length
    },
    counterfactual: {
      nodes: counterfactualGraph.nodes.length,
      edges: counterfactualGraph.edges.length
    },
    changes: {
      removedEdges: removedEdges.length,
      addedEdges: addedEdges.length,
      details: { removed: removedEdges, added: addedEdges }
    }
  };
}

// ============================================================================
// CORRELATION ANALYSIS
// ============================================================================

/**
 * Calculate correlation between two event series
 */
export function calculateCorrelation(seriesA, seriesB) {
  if (seriesA.length !== seriesB.length || seriesA.length < 2) {
    return { correlation: null, error: 'Series must have same length >= 2' };
  }

  const n = seriesA.length;
  const meanA = seriesA.reduce((a, b) => a + b, 0) / n;
  const meanB = seriesB.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denomA = 0;
  let denomB = 0;

  for (let i = 0; i < n; i++) {
    const diffA = seriesA[i] - meanA;
    const diffB = seriesB[i] - meanB;
    numerator += diffA * diffB;
    denomA += diffA * diffA;
    denomB += diffB * diffB;
  }

  const denominator = Math.sqrt(denomA * denomB);
  const correlation = denominator !== 0 ? numerator / denominator : 0;

  let strength = 'none';
  const absCorr = Math.abs(correlation);
  if (absCorr >= 0.8) strength = 'very strong';
  else if (absCorr >= 0.6) strength = 'strong';
  else if (absCorr >= 0.4) strength = 'moderate';
  else if (absCorr >= 0.2) strength = 'weak';

  return {
    correlation,
    strength,
    direction: correlation > 0 ? 'positive' : correlation < 0 ? 'negative' : 'none',
    sampleSize: n
  };
}

/**
 * Find correlated event pairs
 */
export async function findCorrelatedEvents(events, options = {}) {
  const { minCorrelation = 0.5 } = options;

  // Group events by type
  const byType = {};
  events.forEach(e => {
    const type = e.type || e.name || 'unknown';
    if (!byType[type]) byType[type] = [];
    byType[type].push(e.value || 1);
  });

  const types = Object.keys(byType);
  const correlations = [];

  // Calculate pairwise correlations
  for (let i = 0; i < types.length; i++) {
    for (let j = i + 1; j < types.length; j++) {
      const seriesA = byType[types[i]];
      const seriesB = byType[types[j]];

      // Align series by padding shorter one
      const maxLen = Math.max(seriesA.length, seriesB.length);
      const paddedA = [...seriesA, ...Array(maxLen - seriesA.length).fill(0)];
      const paddedB = [...seriesB, ...Array(maxLen - seriesB.length).fill(0)];

      const result = calculateCorrelation(paddedA, paddedB);

      if (result.correlation !== null && Math.abs(result.correlation) >= minCorrelation) {
        correlations.push({
          eventA: types[i],
          eventB: types[j],
          ...result
        });
      }
    }
  }

  return {
    correlations: correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation)),
    totalPairs: (types.length * (types.length - 1)) / 2,
    significantPairs: correlations.length
  };
}

// ============================================================================
// SCHEMA FOR CAUSAL DATA
// ============================================================================

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS causal_analyses (
        id SERIAL PRIMARY KEY,
        analysis_type VARCHAR(50),
        input_summary TEXT,
        results JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    schemaReady = true;
  } catch (e) {
    console.error('[Causal] Schema error:', e.message);
  }
}

/**
 * Store causal analysis for learning
 */
export async function storeAnalysis(type, inputSummary, results) {
  await ensureSchema();

  await db.query(`
    INSERT INTO causal_analyses (analysis_type, input_summary, results)
    VALUES ($1, $2, $3)
  `, [type, inputSummary, JSON.stringify(results)]);
}

export default {
  // Graph construction
  buildCausalGraph,
  storeCausalGraph,

  // Root cause analysis
  findRootCauses,
  analyzeRootCause,

  // Impact prediction
  predictImpact,

  // Intervention
  simulateIntervention,

  // Correlation
  calculateCorrelation,
  findCorrelatedEvents,

  // Storage
  storeAnalysis
};
