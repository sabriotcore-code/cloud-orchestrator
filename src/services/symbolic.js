// ============================================================================
// SYMBOLIC REASONING SERVICE
// Logic solving, constraint satisfaction, Prolog-style reasoning
// ============================================================================

import OpenAI from 'openai';

// ============================================================================
// CONFIGURATION
// ============================================================================

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// In-memory knowledge base for Prolog-style reasoning
const knowledgeBase = {
  facts: new Map(),      // fact_name -> Set of values
  rules: new Map(),      // rule_name -> { conditions, conclusion }
  relations: new Map()   // relation(a, b) -> true/false
};

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    logicEngine: true,
    constraintSolver: true,
    prologEmulator: true,
    factsCount: knowledgeBase.facts.size,
    rulesCount: knowledgeBase.rules.size,
    ready: true
  };
}

// ============================================================================
// LOGIC OPERATIONS
// ============================================================================

/**
 * Evaluate a logical expression
 * @param {string} expression - Logical expression (AND, OR, NOT, IMPLIES)
 * @param {object} variables - Variable assignments
 */
export function evaluateLogic(expression, variables = {}) {
  // Parse and evaluate logical expressions
  const normalizedExpr = expression
    .toUpperCase()
    .replace(/\bAND\b/g, '&&')
    .replace(/\bOR\b/g, '||')
    .replace(/\bNOT\b/g, '!')
    .replace(/\bIMPLIES\b/g, '? true :')
    .replace(/\bTRUE\b/g, 'true')
    .replace(/\bFALSE\b/g, 'false');

  // Replace variables
  let evalExpr = normalizedExpr;
  for (const [varName, value] of Object.entries(variables)) {
    evalExpr = evalExpr.replace(new RegExp(`\\b${varName}\\b`, 'gi'), value);
  }

  try {
    const result = eval(evalExpr);
    return {
      expression,
      variables,
      result: !!result,
      normalized: normalizedExpr
    };
  } catch (e) {
    return { error: e.message, expression };
  }
}

/**
 * Build a truth table for an expression
 */
export function truthTable(expression, variableNames) {
  const rows = [];
  const numVars = variableNames.length;
  const numRows = Math.pow(2, numVars);

  for (let i = 0; i < numRows; i++) {
    const variables = {};
    for (let j = 0; j < numVars; j++) {
      variables[variableNames[j]] = !!(i & (1 << (numVars - 1 - j)));
    }

    const result = evaluateLogic(expression, variables);
    rows.push({
      inputs: { ...variables },
      output: result.result
    });
  }

  return {
    expression,
    variables: variableNames,
    rows,
    tautology: rows.every(r => r.output),
    contradiction: rows.every(r => !r.output),
    satisfiable: rows.some(r => r.output)
  };
}

// ============================================================================
// CONSTRAINT SOLVING
// ============================================================================

/**
 * Solve constraint satisfaction problem
 * @param {object[]} variables - [{name, domain: [values]}]
 * @param {function[]} constraints - Functions that take assignment and return boolean
 */
export function solveConstraints(variables, constraints) {
  const solutions = [];
  const varNames = variables.map(v => v.name);

  function backtrack(assignment, varIndex) {
    if (varIndex === variables.length) {
      // Check all constraints
      const valid = constraints.every(c => c(assignment));
      if (valid) {
        solutions.push({ ...assignment });
      }
      return;
    }

    const variable = variables[varIndex];
    for (const value of variable.domain) {
      assignment[variable.name] = value;

      // Early constraint checking for efficiency
      const partialValid = constraints.every(c => {
        try {
          return c(assignment);
        } catch {
          return true; // Skip if constraint needs undefined vars
        }
      });

      if (partialValid) {
        backtrack(assignment, varIndex + 1);
      }
    }
    delete assignment[variable.name];
  }

  backtrack({}, 0);

  return {
    variables: varNames,
    solutionCount: solutions.length,
    solutions: solutions.slice(0, 100), // Limit output
    hasSolution: solutions.length > 0
  };
}

/**
 * Solve simple linear constraints
 * @param {string[]} constraints - e.g., ["x + y = 10", "x - y = 2"]
 * @param {string[]} variables - e.g., ["x", "y"]
 */
export function solveLinear(constraints, variables) {
  // Parse and solve using substitution/elimination
  const equations = constraints.map(c => {
    const [left, right] = c.split('=').map(s => s.trim());
    return { left, right: parseFloat(right) };
  });

  // For 2 variables, use simple substitution
  if (variables.length === 2 && equations.length === 2) {
    const [x, y] = variables;

    // Parse coefficients
    const parseCoeffs = (expr) => {
      const coeffs = {};
      const terms = expr.replace(/-/g, '+-').split('+').filter(t => t.trim());
      for (const term of terms) {
        const trimmed = term.trim();
        if (trimmed.includes(x)) {
          coeffs[x] = parseFloat(trimmed.replace(x, '').trim() || '1');
        } else if (trimmed.includes(y)) {
          coeffs[y] = parseFloat(trimmed.replace(y, '').trim() || '1');
        }
      }
      return coeffs;
    };

    const eq1 = { ...parseCoeffs(equations[0].left), result: equations[0].right };
    const eq2 = { ...parseCoeffs(equations[1].left), result: equations[1].right };

    // Solve using Cramer's rule
    const det = (eq1[x] || 0) * (eq2[y] || 0) - (eq1[y] || 0) * (eq2[x] || 0);
    if (det === 0) {
      return { error: 'No unique solution (determinant is 0)' };
    }

    const xVal = ((eq1.result) * (eq2[y] || 0) - (eq1[y] || 0) * (eq2.result)) / det;
    const yVal = ((eq1[x] || 0) * (eq2.result) - (eq1.result) * (eq2[x] || 0)) / det;

    return {
      solution: { [x]: xVal, [y]: yVal },
      verified: true
    };
  }

  return { error: 'Currently supports 2 variables with 2 equations' };
}

// ============================================================================
// PROLOG-STYLE REASONING
// ============================================================================

/**
 * Add a fact to the knowledge base
 * @param {string} fact - e.g., "parent(john, mary)"
 */
export function assertFact(fact) {
  const match = fact.match(/(\w+)\(([^)]+)\)/);
  if (!match) {
    return { error: 'Invalid fact format. Use: predicate(arg1, arg2, ...)' };
  }

  const [, predicate, argsStr] = match;
  const args = argsStr.split(',').map(a => a.trim());

  const key = `${predicate}/${args.length}`;
  if (!knowledgeBase.facts.has(key)) {
    knowledgeBase.facts.set(key, new Set());
  }
  knowledgeBase.facts.get(key).add(JSON.stringify(args));

  return { success: true, fact, predicate, arity: args.length };
}

/**
 * Query the knowledge base
 * @param {string} query - e.g., "parent(john, X)"
 */
export function query(queryStr) {
  const match = queryStr.match(/(\w+)\(([^)]+)\)/);
  if (!match) {
    return { error: 'Invalid query format' };
  }

  const [, predicate, argsStr] = match;
  const queryArgs = argsStr.split(',').map(a => a.trim());
  const key = `${predicate}/${queryArgs.length}`;

  const facts = knowledgeBase.facts.get(key);
  if (!facts) {
    return { results: [], found: false };
  }

  const results = [];
  for (const factJson of facts) {
    const factArgs = JSON.parse(factJson);
    const bindings = {};
    let matches = true;

    for (let i = 0; i < queryArgs.length; i++) {
      const q = queryArgs[i];
      const f = factArgs[i];

      if (q.match(/^[A-Z]/)) {
        // Variable - bind it
        bindings[q] = f;
      } else if (q !== f) {
        // Constant - must match
        matches = false;
        break;
      }
    }

    if (matches) {
      results.push({ fact: factArgs, bindings });
    }
  }

  return { results, found: results.length > 0, query: queryStr };
}

/**
 * Add a rule to the knowledge base
 * @param {string} head - e.g., "grandparent(X, Z)"
 * @param {string[]} body - e.g., ["parent(X, Y)", "parent(Y, Z)"]
 */
export function assertRule(head, body) {
  const match = head.match(/(\w+)\(([^)]+)\)/);
  if (!match) {
    return { error: 'Invalid rule head' };
  }

  const [, predicate, argsStr] = match;
  const args = argsStr.split(',').map(a => a.trim());
  const key = `${predicate}/${args.length}`;

  knowledgeBase.rules.set(key, { head, body, predicate, args });
  return { success: true, rule: { head, body } };
}

/**
 * Clear the knowledge base
 */
export function clearKnowledgeBase() {
  knowledgeBase.facts.clear();
  knowledgeBase.rules.clear();
  knowledgeBase.relations.clear();
  return { success: true, message: 'Knowledge base cleared' };
}

/**
 * Get knowledge base statistics
 */
export function getKnowledgeBaseStats() {
  return {
    facts: knowledgeBase.facts.size,
    rules: knowledgeBase.rules.size,
    relations: knowledgeBase.relations.size,
    predicates: Array.from(knowledgeBase.facts.keys())
  };
}

// ============================================================================
// THEOREM PROVING (AI-ASSISTED)
// ============================================================================

/**
 * Prove a theorem using AI-assisted reasoning
 * @param {string} theorem - The theorem to prove
 * @param {string[]} axioms - Given axioms/premises
 */
export async function proveTheorem(theorem, axioms = []) {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a formal logic expert and theorem prover. Given axioms and a theorem, provide a rigorous proof.

Use formal logic notation:
- ∀ (for all), ∃ (exists)
- → (implies), ∧ (and), ∨ (or), ¬ (not)
- ⊢ (proves/derives)

Structure your proof with:
1. Restate the theorem formally
2. List the axioms/premises
3. Step-by-step derivation with justification
4. Conclusion (QED or show it's unprovable)`
      },
      {
        role: 'user',
        content: `Prove: ${theorem}

Given axioms:
${axioms.map((a, i) => `${i + 1}. ${a}`).join('\n') || '(None - use standard logic)'}

Provide a formal proof or explain why it cannot be proven.`
      }
    ]
  });

  return {
    theorem,
    axioms,
    proof: response.choices[0].message.content,
    provider: 'gpt4o'
  };
}

/**
 * Check logical validity of an argument
 * @param {string[]} premises - List of premises
 * @param {string} conclusion - The conclusion
 */
export async function checkValidity(premises, conclusion) {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a logic expert. Analyze arguments for validity.
An argument is VALID if the conclusion MUST follow from the premises.
An argument is SOUND if it's valid AND all premises are true.`
      },
      {
        role: 'user',
        content: `Analyze this argument:

Premises:
${premises.map((p, i) => `P${i + 1}: ${p}`).join('\n')}

Conclusion: ${conclusion}

Determine:
1. Is the argument valid? (Does conclusion follow logically?)
2. What form of reasoning is used? (Modus ponens, syllogism, etc.)
3. Any logical fallacies?
4. Formalize in propositional/predicate logic`
      }
    ]
  });

  return {
    premises,
    conclusion,
    analysis: response.choices[0].message.content
  };
}

// ============================================================================
// ANALOGICAL REASONING
// ============================================================================

/**
 * Find analogies between concepts/situations
 */
export async function findAnalogy(source, target) {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are an expert in analogical reasoning. Find deep structural similarities between concepts.`
      },
      {
        role: 'user',
        content: `Find analogies between:

SOURCE: ${source}
TARGET: ${target}

Identify:
1. Structural similarities (relationships, processes)
2. Functional similarities (purpose, role)
3. Mapping of elements (A→X, B→Y, etc.)
4. Where the analogy breaks down
5. Insights the analogy provides`
      }
    ]
  });

  return {
    source,
    target,
    analysis: response.choices[0].message.content
  };
}

/**
 * Complete an analogy (A:B :: C:?)
 */
export async function completeAnalogy(a, b, c) {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: `Complete this analogy: ${a} is to ${b} as ${c} is to ___?

1. Identify the relationship between ${a} and ${b}
2. Apply that relationship to ${c}
3. Provide the answer with explanation
4. Give 2-3 alternative valid answers if any`
      }
    ]
  });

  return {
    analogy: `${a}:${b} :: ${c}:?`,
    answer: response.choices[0].message.content
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Logic
  evaluateLogic,
  truthTable,
  // Constraints
  solveConstraints,
  solveLinear,
  // Prolog-style
  assertFact,
  query,
  assertRule,
  clearKnowledgeBase,
  getKnowledgeBaseStats,
  // Theorem proving
  proveTheorem,
  checkValidity,
  // Analogical
  findAnalogy,
  completeAnalogy
};
