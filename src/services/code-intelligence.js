// ============================================================================
// CODE INTELLIGENCE - AST Analysis, Test Generation, Bug Detection, Complexity
// Deep code understanding and automated code quality tools
// ============================================================================

import OpenAI from 'openai';

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ============================================================================
// CODE ANALYSIS
// ============================================================================

/**
 * Analyze code structure and metrics
 */
export async function analyzeCode(code, language = 'javascript', options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are an expert code analyzer. Analyze code structure, quality, and metrics.
Return JSON:
{
  "language": "detected language",
  "structure": {
    "functions": [{"name": "...", "params": [...], "returnType": "...", "lines": [start, end]}],
    "classes": [{"name": "...", "methods": [...], "properties": [...]}],
    "imports": ["module1", "module2"],
    "exports": ["export1"]
  },
  "metrics": {
    "loc": number,
    "sloc": number,
    "comments": number,
    "functions": number,
    "classes": number,
    "complexity": number,
    "maintainabilityIndex": number
  },
  "dependencies": ["dep1", "dep2"],
  "patterns": ["singleton", "factory", etc],
  "summary": "brief description of what code does"
}`
      },
      { role: 'user', content: `Language: ${language}\n\n${code}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2500
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Calculate cyclomatic complexity
 */
export function calculateComplexity(code, language = 'javascript') {
  // Simple complexity calculation based on decision points
  let complexity = 1; // Base complexity

  const patterns = {
    javascript: {
      decisions: /\b(if|else if|for|while|do|switch|case|catch|\?|&&|\|\|)\b/g,
      functions: /\b(function|=>)\b/g
    },
    python: {
      decisions: /\b(if|elif|for|while|except|and|or)\b/g,
      functions: /\bdef\b/g
    },
    java: {
      decisions: /\b(if|else if|for|while|do|switch|case|catch|\?|&&|\|\|)\b/g,
      functions: /\b(void|int|String|boolean|public|private|protected)\s+\w+\s*\(/g
    }
  };

  const lang = patterns[language.toLowerCase()] || patterns.javascript;

  const decisions = (code.match(lang.decisions) || []).length;
  const functions = (code.match(lang.functions) || []).length;

  complexity += decisions;

  // Nesting depth analysis
  let maxNesting = 0;
  let currentNesting = 0;
  for (const char of code) {
    if (char === '{') {
      currentNesting++;
      maxNesting = Math.max(maxNesting, currentNesting);
    } else if (char === '}') {
      currentNesting--;
    }
  }

  return {
    cyclomatic: complexity,
    decisionPoints: decisions,
    functionCount: functions,
    maxNestingDepth: maxNesting,
    rating: complexity <= 10 ? 'low' : complexity <= 20 ? 'moderate' : complexity <= 50 ? 'high' : 'very_high',
    recommendation: complexity > 20 ? 'Consider refactoring to reduce complexity' : 'Complexity is acceptable'
  };
}

/**
 * Detect code smells
 */
export async function detectCodeSmells(code, language = 'javascript', options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a code quality expert. Detect code smells and anti-patterns.
Return JSON:
{
  "smells": [
    {
      "type": "long_method/duplicate_code/dead_code/god_class/etc",
      "severity": "critical/high/medium/low",
      "location": "line number or function name",
      "description": "what the problem is",
      "suggestion": "how to fix it"
    }
  ],
  "antiPatterns": [
    {"pattern": "name", "description": "...", "impact": "..."}
  ],
  "qualityScore": 0-100,
  "summary": "overall code quality assessment"
}`
      },
      { role: 'user', content: `Language: ${language}\n\n${code}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Detect potential bugs
 */
export async function detectBugs(code, language = 'javascript', options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a bug detection expert. Find potential bugs, logic errors, and issues.
Return JSON:
{
  "bugs": [
    {
      "type": "null_pointer/array_bounds/type_error/logic_error/race_condition/etc",
      "severity": "critical/high/medium/low",
      "line": number or "unknown",
      "code": "problematic code snippet",
      "description": "what could go wrong",
      "fix": "suggested fix"
    }
  ],
  "warnings": [
    {"type": "...", "description": "...", "line": number}
  ],
  "securityIssues": [
    {"type": "xss/injection/etc", "severity": "...", "description": "..."}
  ],
  "confidence": 0-100,
  "summary": "overall bug assessment"
}`
      },
      { role: 'user', content: `Language: ${language}\n\n${code}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2500
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// TEST GENERATION
// ============================================================================

/**
 * Generate unit tests for code
 */
export async function generateTests(code, language = 'javascript', options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { framework = 'jest', coverage = 'comprehensive' } = options;

  const frameworks = {
    javascript: { jest: 'Jest', mocha: 'Mocha', vitest: 'Vitest' },
    python: { pytest: 'pytest', unittest: 'unittest' },
    java: { junit: 'JUnit', testng: 'TestNG' }
  };

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a test generation expert. Generate ${coverage} unit tests using ${framework}.
Return JSON:
{
  "tests": "complete test code",
  "testCases": [
    {
      "name": "test case name",
      "description": "what it tests",
      "type": "unit/integration/edge_case",
      "coverage": "what code path is covered"
    }
  ],
  "mocks": ["what needs to be mocked"],
  "setup": "any setup code needed",
  "coverageEstimate": "percentage of code covered"
}`
      },
      { role: 'user', content: `Language: ${language}\nFramework: ${framework}\n\nCode to test:\n${code}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 4000
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Generate test data
 */
export async function generateTestData(schema, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { count = 5, edge_cases = true } = options;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Generate ${count} test data samples based on the schema. ${edge_cases ? 'Include edge cases.' : ''}
Return JSON:
{
  "samples": [/* array of test data objects */],
  "edgeCases": [/* array of edge case data with description */],
  "invalidSamples": [/* array of invalid data for negative testing */]
}`
      },
      { role: 'user', content: `Schema:\n${JSON.stringify(schema, null, 2)}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// CODE GENERATION
// ============================================================================

/**
 * Generate code from description
 */
export async function generateCode(description, language = 'javascript', options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { style = 'clean', includeComments = true, includeTypes = true } = options;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are an expert ${language} developer. Generate clean, production-ready code.
${includeComments ? 'Include helpful comments.' : ''}
${includeTypes ? 'Include type annotations where applicable.' : ''}
Return JSON:
{
  "code": "the generated code",
  "explanation": "how the code works",
  "dependencies": ["required dependencies"],
  "usage": "example usage",
  "tests": "example test cases"
}`
      },
      { role: 'user', content: `Language: ${language}\nDescription: ${description}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 4000
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Convert code between languages
 */
export async function convertCode(code, fromLang, toLang, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Convert code from ${fromLang} to ${toLang}. Maintain functionality and use idiomatic patterns.
Return JSON:
{
  "code": "converted code",
  "notes": ["differences or considerations"],
  "dependencies": ["required libraries in target language"],
  "equivalentFeatures": {"original": "target equivalent"}
}`
      },
      { role: 'user', content: code }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 4000
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Optimize code
 */
export async function optimizeCode(code, language = 'javascript', options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { focus = 'performance' } = options; // performance, memory, readability

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Optimize code for ${focus}. Provide detailed improvements.
Return JSON:
{
  "optimizedCode": "the optimized code",
  "improvements": [
    {
      "type": "algorithm/memory/readability/etc",
      "original": "original code snippet",
      "optimized": "optimized code snippet",
      "improvement": "what was improved",
      "impact": "estimated impact"
    }
  ],
  "performanceGain": "estimated improvement",
  "tradeoffs": ["any tradeoffs made"]
}`
      },
      { role: 'user', content: `Language: ${language}\nFocus: ${focus}\n\n${code}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 4000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// CODE REFACTORING
// ============================================================================

/**
 * Suggest refactoring improvements
 */
export async function suggestRefactoring(code, language = 'javascript', options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Analyze code and suggest refactoring improvements.
Return JSON:
{
  "refactorings": [
    {
      "type": "extract_method/rename/inline/move/etc",
      "priority": "high/medium/low",
      "before": "code before",
      "after": "code after",
      "reason": "why this refactoring helps",
      "effort": "low/medium/high"
    }
  ],
  "designPatterns": [
    {"pattern": "name", "applicability": "how it could help", "example": "..."}
  ],
  "architecturalSuggestions": ["suggestion 1"],
  "summary": "overall refactoring assessment"
}`
      },
      { role: 'user', content: `Language: ${language}\n\n${code}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 3000
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Apply specific refactoring
 */
export async function applyRefactoring(code, refactoringType, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const refactoringTypes = {
    extract_method: 'Extract the specified code into a new method',
    inline: 'Inline the specified method or variable',
    rename: 'Rename the specified identifier',
    extract_variable: 'Extract expression into a named variable',
    extract_class: 'Extract related fields and methods into a new class',
    move_method: 'Move method to a more appropriate class',
    simplify_conditional: 'Simplify complex conditional logic'
  };

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Apply the ${refactoringType} refactoring: ${refactoringTypes[refactoringType]}
Return JSON:
{
  "refactoredCode": "complete refactored code",
  "changes": ["list of changes made"],
  "notes": ["important notes about the refactoring"]
}`
      },
      { role: 'user', content: `${JSON.stringify(options)}\n\n${code}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 4000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// CODE DOCUMENTATION
// ============================================================================

/**
 * Generate documentation
 */
export async function generateDocs(code, language = 'javascript', options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { format = 'jsdoc', includeExamples = true } = options;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Generate ${format} documentation for the code. ${includeExamples ? 'Include usage examples.' : ''}
Return JSON:
{
  "documentedCode": "code with documentation comments",
  "readme": "README.md content for this code",
  "api": [
    {
      "name": "function/class name",
      "type": "function/class/constant",
      "description": "what it does",
      "params": [{"name": "...", "type": "...", "description": "..."}],
      "returns": {"type": "...", "description": "..."},
      "examples": ["example usage"],
      "throws": ["possible exceptions"]
    }
  ]
}`
      },
      { role: 'user', content: `Language: ${language}\nFormat: ${format}\n\n${code}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 4000
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Explain code
 */
export async function explainCode(code, language = 'javascript', options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { audience = 'developer', detail = 'comprehensive' } = options;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Explain this code for a ${audience} with ${detail} detail.
Return JSON:
{
  "summary": "one-line summary",
  "explanation": "detailed explanation",
  "lineByLine": [
    {"lines": "1-5", "explanation": "what this section does"}
  ],
  "concepts": ["concept 1", "concept 2"],
  "dataFlow": "how data flows through the code",
  "sideEffects": ["side effect 1"],
  "complexity": "time and space complexity",
  "analogies": ["real-world analogy to help understand"]
}`
      },
      { role: 'user', content: `Language: ${language}\n\n${code}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 3000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// CODE REVIEW
// ============================================================================

/**
 * Perform code review
 */
export async function reviewCode(code, language = 'javascript', options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { standards = 'best_practices', strictness = 'moderate' } = options;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Perform a ${strictness} code review following ${standards}.
Return JSON:
{
  "verdict": "approve/request_changes/needs_discussion",
  "score": 0-100,
  "comments": [
    {
      "type": "issue/suggestion/praise/question",
      "severity": "critical/major/minor/nitpick",
      "line": number or "general",
      "comment": "the review comment",
      "suggestion": "how to improve (if applicable)"
    }
  ],
  "strengths": ["what the code does well"],
  "concerns": ["main concerns"],
  "mustFix": ["critical issues that must be fixed"],
  "summary": "overall review summary"
}`
      },
      { role: 'user', content: `Language: ${language}\n\n${code}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 3000
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Review pull request
 */
export async function reviewPullRequest(diff, context = '', options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Review this pull request diff. Consider impact, risks, and best practices.
Return JSON:
{
  "summary": "what this PR does",
  "verdict": "approve/request_changes/needs_discussion",
  "riskLevel": "low/medium/high",
  "changes": {
    "additions": number,
    "deletions": number,
    "filesChanged": ["file1", "file2"]
  },
  "issues": [
    {"severity": "...", "file": "...", "line": number, "issue": "...", "suggestion": "..."}
  ],
  "questions": ["question for author"],
  "testingNotes": ["what should be tested"],
  "deploymentConsiderations": ["things to consider for deployment"]
}`
      },
      { role: 'user', content: `Context: ${context}\n\nDiff:\n${diff}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 3000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// DEPENDENCY ANALYSIS
// ============================================================================

/**
 * Analyze dependencies
 */
export async function analyzeDependencies(packageJson, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Analyze project dependencies for issues, updates, and recommendations.
Return JSON:
{
  "dependencies": [
    {
      "name": "package name",
      "version": "current version",
      "type": "production/dev",
      "status": "ok/outdated/deprecated/vulnerable",
      "latestVersion": "...",
      "recommendation": "..."
    }
  ],
  "securityIssues": [{"package": "...", "severity": "...", "issue": "..."}],
  "unusedSuspects": ["packages that might be unused"],
  "duplicates": ["packages with similar functionality"],
  "recommendations": ["overall recommendations"],
  "bundleSizeImpact": "analysis of size impact"
}`
      },
      { role: 'user', content: JSON.stringify(packageJson, null, 2) }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 3000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// CODE SEARCH & NAVIGATION
// ============================================================================

/**
 * Find code patterns
 */
export async function findPatterns(code, pattern, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Find all occurrences of the pattern or concept in the code.
Return JSON:
{
  "matches": [
    {
      "location": "line number or function name",
      "code": "matching code snippet",
      "context": "surrounding context",
      "confidence": 0-1
    }
  ],
  "count": number,
  "relatedPatterns": ["similar patterns found"]
}`
      },
      { role: 'user', content: `Pattern: ${pattern}\n\nCode:\n${code}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Understand code relationships
 */
export async function analyzeRelationships(code, language = 'javascript', options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Analyze relationships between code elements (functions, classes, modules).
Return JSON:
{
  "elements": [
    {"name": "...", "type": "function/class/module", "dependencies": ["..."], "dependents": ["..."]}
  ],
  "callGraph": [
    {"caller": "...", "callee": "...", "type": "direct/indirect"}
  ],
  "inheritanceTree": [
    {"class": "...", "extends": "...", "implements": ["..."]}
  ],
  "dataFlow": [
    {"from": "...", "to": "...", "data": "what data flows"}
  ],
  "couplingAnalysis": {
    "tightlyCoupled": [["elem1", "elem2"]],
    "score": 0-100,
    "suggestions": ["how to reduce coupling"]
  }
}`
      },
      { role: 'user', content: `Language: ${language}\n\n${code}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 3000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    codeAnalysis: !!openai,
    complexity: true,
    bugDetection: !!openai,
    testGeneration: !!openai,
    codeGeneration: !!openai,
    refactoring: !!openai,
    documentation: !!openai,
    codeReview: !!openai,
    capabilities: [
      'code_analysis', 'complexity_calculation', 'code_smell_detection',
      'bug_detection', 'security_analysis',
      'test_generation', 'test_data_generation',
      'code_generation', 'code_conversion', 'code_optimization',
      'refactoring_suggestions', 'refactoring_application',
      'documentation_generation', 'code_explanation',
      'code_review', 'pr_review',
      'dependency_analysis', 'pattern_finding', 'relationship_analysis'
    ],
    ready: !!openai
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Analysis
  analyzeCode, calculateComplexity, detectCodeSmells, detectBugs,
  // Testing
  generateTests, generateTestData,
  // Generation
  generateCode, convertCode, optimizeCode,
  // Refactoring
  suggestRefactoring, applyRefactoring,
  // Documentation
  generateDocs, explainCode,
  // Review
  reviewCode, reviewPullRequest,
  // Dependencies
  analyzeDependencies,
  // Search
  findPatterns, analyzeRelationships
};
