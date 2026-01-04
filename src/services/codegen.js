/**
 * ADVANCED CODE GENERATION ENGINE
 *
 * Dynamically generates and executes code:
 * - Multi-language code generation
 * - Code review and improvement
 * - Test generation
 * - Secure sandbox execution via E2B
 * - Self-healing code patterns
 */

import * as db from '../db/index.js';
import * as aiProviders from './ai-providers.js';
import * as e2b from './e2b.js';

// ============================================================================
// CODE GENERATION
// ============================================================================

/**
 * Generate code from natural language description
 */
export async function generateCode(description, options = {}) {
  const {
    language = 'javascript',
    style = 'clean',
    includeTests = false,
    includeComments = true
  } = options;

  const styleGuides = {
    clean: 'Write clean, readable code with meaningful variable names.',
    minimal: 'Write minimal, concise code. Avoid unnecessary abstractions.',
    defensive: 'Write defensive code with comprehensive error handling.',
    performant: 'Optimize for performance. Use efficient algorithms and data structures.'
  };

  const prompt = `Generate ${language} code for the following requirement:

${description}

Style: ${styleGuides[style] || styleGuides.clean}
${includeComments ? 'Include helpful comments.' : 'Minimal comments.'}
${includeTests ? 'Include unit tests.' : ''}

Return ONLY the code, no explanations. Use proper formatting.`;

  const response = await aiProviders.chat('gpt4o', prompt);

  // Extract code from response
  const code = extractCodeBlock(response.response, language);

  return {
    code,
    language,
    description,
    model: 'gpt4o',
    latencyMs: response.latencyMs
  };
}

/**
 * Generate multiple implementations for comparison
 */
export async function generateVariants(description, language = 'javascript', count = 3) {
  const styles = ['clean', 'minimal', 'performant'];
  const variants = [];

  const promises = styles.slice(0, count).map(async (style) => {
    const result = await generateCode(description, { language, style });
    return { style, ...result };
  });

  const results = await Promise.all(promises);
  return results;
}

/**
 * Extract code block from markdown response
 */
function extractCodeBlock(text, language) {
  // Try to find fenced code block
  const fenceRegex = new RegExp(`\`\`\`(?:${language})?\\s*([\\s\\S]*?)\`\`\``, 'i');
  const match = text.match(fenceRegex);

  if (match) {
    return match[1].trim();
  }

  // If no fence, try to find code-like content
  const lines = text.split('\n');
  const codeLines = lines.filter(line =>
    line.includes('function') ||
    line.includes('const ') ||
    line.includes('let ') ||
    line.includes('import ') ||
    line.includes('def ') ||
    line.includes('class ') ||
    line.match(/^\s*[{}\[\]();]/)
  );

  if (codeLines.length > 0) {
    return text.trim();
  }

  return text.trim();
}

// ============================================================================
// CODE REVIEW & IMPROVEMENT
// ============================================================================

/**
 * Review code and suggest improvements
 */
export async function reviewCode(code, options = {}) {
  const { focus = 'all', language = 'auto' } = options;

  const focusAreas = {
    all: 'Review for: bugs, security, performance, readability, and best practices.',
    security: 'Focus on security vulnerabilities: injection, XSS, authentication, authorization.',
    performance: 'Focus on performance: time complexity, memory usage, bottlenecks.',
    bugs: 'Focus on potential bugs: edge cases, null checks, race conditions.',
    style: 'Focus on code style: naming, formatting, documentation.'
  };

  const prompt = `Review this ${language !== 'auto' ? language : ''} code:

\`\`\`
${code}
\`\`\`

${focusAreas[focus] || focusAreas.all}

Provide:
1. Issues found (severity: critical/warning/info)
2. Specific line numbers
3. Suggested fixes`;

  const response = await aiProviders.chat('claude', prompt);

  return {
    review: response.response,
    focus,
    codeLength: code.length,
    model: 'claude'
  };
}

/**
 * Automatically improve code
 */
export async function improveCode(code, improvements = ['readability', 'performance']) {
  const prompt = `Improve this code for: ${improvements.join(', ')}.

Original code:
\`\`\`
${code}
\`\`\`

Return the improved code only, with brief comments explaining changes.`;

  const response = await aiProviders.chat('gpt4o', prompt);
  const improvedCode = extractCodeBlock(response.response, 'javascript');

  return {
    original: code,
    improved: improvedCode,
    improvements,
    model: 'gpt4o'
  };
}

/**
 * Fix bugs in code
 */
export async function fixCode(code, errorMessage) {
  const prompt = `Fix this code that produces the following error:

Error: ${errorMessage}

Code:
\`\`\`
${code}
\`\`\`

Return ONLY the fixed code.`;

  const response = await aiProviders.chat('claude', prompt);
  const fixedCode = extractCodeBlock(response.response, 'javascript');

  return {
    original: code,
    fixed: fixedCode,
    error: errorMessage,
    model: 'claude'
  };
}

// ============================================================================
// TEST GENERATION
// ============================================================================

/**
 * Generate tests for code
 */
export async function generateTests(code, options = {}) {
  const {
    framework = 'jest',
    coverage = 'comprehensive',
    language = 'javascript'
  } = options;

  const coverageTypes = {
    basic: 'Generate basic happy-path tests.',
    comprehensive: 'Generate comprehensive tests including edge cases and error conditions.',
    exhaustive: 'Generate exhaustive tests with boundary conditions, error handling, and performance tests.'
  };

  const prompt = `Generate ${framework} tests for this ${language} code:

\`\`\`${language}
${code}
\`\`\`

${coverageTypes[coverage] || coverageTypes.comprehensive}

Return only the test code.`;

  const response = await aiProviders.chat('gpt4o', prompt);
  const tests = extractCodeBlock(response.response, language);

  return {
    tests,
    framework,
    coverage,
    model: 'gpt4o'
  };
}

// ============================================================================
// CODE EXECUTION (via E2B)
// ============================================================================

/**
 * Generate and execute code
 */
export async function generateAndExecute(description, options = {}) {
  const { language = 'javascript', timeout = 30000 } = options;

  // Generate code
  const generated = await generateCode(description, { language });

  if (!generated.code) {
    return { error: 'Failed to generate code', generated };
  }

  // Execute in sandbox
  try {
    const execution = await e2b.executeCode(generated.code, language, { timeout });

    return {
      description,
      code: generated.code,
      execution,
      success: !execution.error,
      latencyMs: generated.latencyMs + (execution.latencyMs || 0)
    };
  } catch (error) {
    return {
      description,
      code: generated.code,
      error: error.message,
      success: false
    };
  }
}

/**
 * Self-healing execution: fix and retry on error
 */
export async function selfHealingExecute(description, options = {}) {
  const { maxRetries = 3, language = 'javascript' } = options;

  let result = await generateAndExecute(description, { language });

  for (let attempt = 1; attempt <= maxRetries && !result.success; attempt++) {
    console.log(`[CodeGen] Attempt ${attempt}: Fixing code...`);

    // Fix the code based on error
    const fixed = await fixCode(result.code, result.error || result.execution?.error);

    // Re-execute
    try {
      const execution = await e2b.executeCode(fixed.fixed, language);

      result = {
        description,
        code: fixed.fixed,
        execution,
        success: !execution.error,
        attempts: attempt + 1,
        history: [...(result.history || []), { code: result.code, error: result.error }]
      };
    } catch (error) {
      result.error = error.message;
      result.attempts = attempt + 1;
    }
  }

  return result;
}

// ============================================================================
// CODE TRANSFORMATION
// ============================================================================

/**
 * Convert code between languages
 */
export async function convertCode(code, fromLang, toLang) {
  const prompt = `Convert this ${fromLang} code to ${toLang}:

\`\`\`${fromLang}
${code}
\`\`\`

Maintain the same functionality. Use idiomatic ${toLang} patterns.
Return only the converted code.`;

  const response = await aiProviders.chat('claude', prompt);
  const converted = extractCodeBlock(response.response, toLang);

  return {
    original: code,
    converted,
    fromLanguage: fromLang,
    toLanguage: toLang,
    model: 'claude'
  };
}

/**
 * Refactor code with specific pattern
 */
export async function refactorCode(code, pattern) {
  const patterns = {
    'extract-function': 'Extract reusable logic into separate functions.',
    'add-types': 'Add TypeScript type annotations.',
    'async-await': 'Convert callbacks/promises to async/await.',
    'functional': 'Refactor to functional programming style.',
    'oop': 'Refactor to object-oriented design.',
    'modular': 'Split into modules with clear interfaces.'
  };

  const instruction = patterns[pattern] || pattern;

  const prompt = `Refactor this code: ${instruction}

\`\`\`
${code}
\`\`\`

Return the refactored code with comments explaining major changes.`;

  const response = await aiProviders.chat('claude', prompt);
  const refactored = extractCodeBlock(response.response, 'javascript');

  return {
    original: code,
    refactored,
    pattern,
    model: 'claude'
  };
}

// ============================================================================
// SCHEMA FOR CODE HISTORY
// ============================================================================

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS code_generations (
        id SERIAL PRIMARY KEY,
        description TEXT,
        language VARCHAR(50),
        code TEXT,
        tests TEXT,
        execution_result JSONB,
        success BOOLEAN,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    schemaReady = true;
  } catch (e) {
    console.error('[CodeGen] Schema error:', e.message);
  }
}

/**
 * Store code generation for learning
 */
export async function storeGeneration(data) {
  await ensureSchema();

  const { description, language, code, tests, executionResult, success } = data;

  await db.query(`
    INSERT INTO code_generations (description, language, code, tests, execution_result, success)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [description, language, code, tests, JSON.stringify(executionResult), success]);
}

export default {
  // Generation
  generateCode,
  generateVariants,

  // Review
  reviewCode,
  improveCode,
  fixCode,

  // Testing
  generateTests,

  // Execution
  generateAndExecute,
  selfHealingExecute,

  // Transformation
  convertCode,
  refactorCode,

  // Storage
  storeGeneration
};
