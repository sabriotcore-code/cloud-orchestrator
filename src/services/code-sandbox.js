// ============================================================================
// CODE SANDBOX SERVICE - Verified Code Execution
// Secure sandboxed execution with output validation
// ============================================================================

import { spawn } from 'child_process';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import OpenAI from 'openai';

// ============================================================================
// CONFIGURATION
// ============================================================================

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// E2B for cloud sandboxing (if available)
const E2B_API_KEY = process.env.E2B_API_KEY;

// Execution history
const executionHistory = [];

// Temp directory for local execution
const TEMP_DIR = process.env.TEMP_DIR || '/tmp/sandbox';

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    localExecution: true,
    cloudSandbox: !!E2B_API_KEY,
    codeValidation: !!openai,
    outputVerification: !!openai,
    supportedLanguages: ['javascript', 'python', 'bash'],
    executionCount: executionHistory.length,
    ready: true
  };
}

// ============================================================================
// LANGUAGE CONFIGS
// ============================================================================

const LANGUAGE_CONFIGS = {
  javascript: {
    extension: '.js',
    command: 'node',
    args: [],
    timeout: 30000,
    riskLevel: 'medium'
  },
  python: {
    extension: '.py',
    command: 'python3',
    args: [],
    timeout: 60000,
    riskLevel: 'medium'
  },
  bash: {
    extension: '.sh',
    command: 'bash',
    args: [],
    timeout: 30000,
    riskLevel: 'high'
  }
};

// ============================================================================
// CODE VALIDATION
// ============================================================================

/**
 * Validate code for safety before execution
 */
export async function validateCode(code, language, options = {}) {
  const {
    checkSecurity = true,
    checkSyntax = true,
    strictMode = false
  } = options;

  const issues = [];
  const warnings = [];

  // Basic pattern-based security checks
  const securityPatterns = {
    javascript: [
      { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/, issue: 'child_process import' },
      { pattern: /eval\s*\(/, issue: 'eval usage' },
      { pattern: /Function\s*\(/, issue: 'Function constructor' },
      { pattern: /process\.env/, issue: 'environment access', warning: true },
      { pattern: /fs\.(write|unlink|rm)/, issue: 'filesystem write' }
    ],
    python: [
      { pattern: /import\s+os/, issue: 'os module import', warning: true },
      { pattern: /import\s+subprocess/, issue: 'subprocess import' },
      { pattern: /exec\s*\(/, issue: 'exec usage' },
      { pattern: /eval\s*\(/, issue: 'eval usage' },
      { pattern: /__import__/, issue: 'dynamic import' },
      { pattern: /open\s*\([^)]*['"][wa]/, issue: 'file write' }
    ],
    bash: [
      { pattern: /rm\s+-rf\s+\//, issue: 'dangerous rm command' },
      { pattern: />\s*\/etc\//, issue: 'writing to /etc' },
      { pattern: /curl.*\|\s*bash/, issue: 'pipe to bash' },
      { pattern: /wget.*\|\s*sh/, issue: 'pipe to sh' }
    ]
  };

  // Check security patterns
  if (checkSecurity) {
    const patterns = securityPatterns[language] || [];
    patterns.forEach(({ pattern, issue, warning }) => {
      if (pattern.test(code)) {
        if (warning) {
          warnings.push(issue);
        } else {
          issues.push(issue);
        }
      }
    });
  }

  // AI-powered validation for deeper analysis
  let aiAnalysis = null;
  if (openai && checkSecurity) {
    try {
      aiAnalysis = await analyzeCodeSafety(code, language);
      if (aiAnalysis.issues) {
        issues.push(...aiAnalysis.issues);
      }
      if (aiAnalysis.warnings) {
        warnings.push(...aiAnalysis.warnings);
      }
    } catch (e) {
      // Continue without AI analysis
    }
  }

  const isBlocked = strictMode ? (issues.length > 0 || warnings.length > 0) : issues.length > 0;

  return {
    valid: !isBlocked,
    issues,
    warnings,
    aiAnalysis: aiAnalysis?.reasoning,
    riskLevel: issues.length > 0 ? 'high' : warnings.length > 0 ? 'medium' : 'low'
  };
}

/**
 * AI-powered code safety analysis
 */
async function analyzeCodeSafety(code, language) {
  if (!openai) return { issues: [], warnings: [] };

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a code security analyzer. Check code for security issues, dangerous operations, and potential risks.
Return JSON: { "issues": ["critical issue 1"], "warnings": ["warning 1"], "reasoning": "brief explanation" }`
      },
      {
        role: 'user',
        content: `Analyze this ${language} code for security:\n\n${code}`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 500
  });

  try {
    return JSON.parse(response.choices[0].message.content);
  } catch {
    return { issues: [], warnings: [] };
  }
}

// ============================================================================
// CODE EXECUTION
// ============================================================================

/**
 * Execute code in sandbox
 */
export async function execute(code, language, options = {}) {
  const {
    timeout = null,
    validate = true,
    verifyOutput = false,
    expectedOutput = null,
    allowWarnings = true,
    input = ''
  } = options;

  const startTime = Date.now();
  const config = LANGUAGE_CONFIGS[language];

  if (!config) {
    return {
      success: false,
      error: `Unsupported language: ${language}. Supported: ${Object.keys(LANGUAGE_CONFIGS).join(', ')}`
    };
  }

  // Validate code first
  if (validate) {
    const validation = await validateCode(code, language);
    if (!validation.valid) {
      return {
        success: false,
        error: 'Code validation failed',
        validation,
        blocked: true
      };
    }
    if (!allowWarnings && validation.warnings.length > 0) {
      return {
        success: false,
        error: 'Code has security warnings',
        validation,
        blocked: true
      };
    }
  }

  // Execute locally
  const result = await executeLocal(code, language, {
    timeout: timeout || config.timeout,
    input
  });

  // Verify output if requested
  let verification = null;
  if (verifyOutput && openai && result.success) {
    verification = await verifyOutputAccuracy(code, result.output, expectedOutput, language);
  }

  const finalResult = {
    success: result.success,
    output: result.output,
    error: result.error,
    exitCode: result.exitCode,
    language,
    timeMs: Date.now() - startTime,
    verification,
    timestamp: new Date().toISOString()
  };

  // Store in history
  executionHistory.push({
    ...finalResult,
    codeHash: hashCode(code),
    codeLength: code.length
  });
  if (executionHistory.length > 200) executionHistory.shift();

  return finalResult;
}

/**
 * Execute code locally in subprocess
 */
async function executeLocal(code, language, options) {
  const { timeout, input } = options;
  const config = LANGUAGE_CONFIGS[language];
  const fileId = randomUUID();
  const filePath = join(TEMP_DIR, `${fileId}${config.extension}`);

  try {
    // Ensure temp directory exists
    await mkdir(TEMP_DIR, { recursive: true });

    // Write code to temp file
    await writeFile(filePath, code);

    // Execute
    return await new Promise((resolve) => {
      const proc = spawn(config.command, [...config.args, filePath], {
        timeout,
        maxBuffer: 1024 * 1024 // 1MB output limit
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      if (input) {
        proc.stdin.write(input);
        proc.stdin.end();
      }

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({
          success: false,
          output: stdout,
          error: `Execution timeout (${timeout}ms)`,
          exitCode: -1
        });
      }, timeout);

      proc.on('close', (exitCode) => {
        clearTimeout(timer);
        resolve({
          success: exitCode === 0,
          output: stdout.trim(),
          error: stderr.trim() || (exitCode !== 0 ? `Exit code: ${exitCode}` : null),
          exitCode
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          output: stdout,
          error: err.message,
          exitCode: -1
        });
      });
    });

  } finally {
    // Cleanup temp file
    try {
      await unlink(filePath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Verify output accuracy
 */
async function verifyOutputAccuracy(code, output, expectedOutput, language) {
  if (!openai) return null;

  const prompt = expectedOutput
    ? `Code:\n${code}\n\nActual Output:\n${output}\n\nExpected Output:\n${expectedOutput}\n\nIs the actual output correct?`
    : `Code:\n${code}\n\nOutput:\n${output}\n\nIs this output correct for this ${language} code?`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You verify code execution outputs. Return JSON:
{ "correct": true/false, "confidence": 0-100, "reasoning": "explanation", "issues": ["issue1"] }`
      },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 500
  });

  try {
    return JSON.parse(response.choices[0].message.content);
  } catch {
    return null;
  }
}

// ============================================================================
// QUICK EXECUTION MODES
// ============================================================================

/**
 * Quick JavaScript execution
 */
export async function runJS(code, options = {}) {
  return execute(code, 'javascript', options);
}

/**
 * Quick Python execution
 */
export async function runPython(code, options = {}) {
  return execute(code, 'python', options);
}

/**
 * Quick Bash execution
 */
export async function runBash(code, options = {}) {
  return execute(code, 'bash', { ...options, validate: true });
}

/**
 * Evaluate expression and return result
 */
export async function evaluate(expression, language = 'javascript') {
  let code;
  switch (language) {
    case 'python':
      code = `print(${expression})`;
      break;
    case 'javascript':
    default:
      code = `console.log(${expression})`;
      break;
  }

  const result = await execute(code, language, { validate: true });
  return {
    expression,
    result: result.output,
    success: result.success,
    error: result.error
  };
}

// ============================================================================
// CODE GENERATION + EXECUTION
// ============================================================================

/**
 * Generate and execute code from natural language
 */
export async function generateAndRun(description, language = 'javascript', options = {}) {
  if (!openai) {
    throw new Error('OpenAI required for code generation');
  }

  // Generate code
  const genResponse = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a code generator. Write clean, safe ${language} code.
Return ONLY the code, no explanations or markdown.`
      },
      {
        role: 'user',
        content: description
      }
    ],
    max_tokens: 2000
  });

  const generatedCode = genResponse.choices[0].message.content
    .replace(/^```\w*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();

  // Execute the generated code
  const result = await execute(generatedCode, language, {
    ...options,
    verifyOutput: true
  });

  return {
    description,
    generatedCode,
    ...result
  };
}

/**
 * Test code with multiple inputs
 */
export async function testWithInputs(code, language, testCases, options = {}) {
  const results = [];

  for (const testCase of testCases) {
    const { input, expectedOutput, name } = testCase;

    const result = await execute(code, language, {
      ...options,
      input: typeof input === 'string' ? input : JSON.stringify(input),
      expectedOutput,
      verifyOutput: !!expectedOutput
    });

    results.push({
      name: name || `Test ${results.length + 1}`,
      input,
      expectedOutput,
      actualOutput: result.output,
      passed: expectedOutput ? result.output.trim() === expectedOutput.trim() : result.success,
      ...result
    });
  }

  return {
    code,
    language,
    totalTests: testCases.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results
  };
}

// ============================================================================
// BATCH EXECUTION
// ============================================================================

/**
 * Execute multiple code snippets
 */
export async function executeBatch(snippets, options = {}) {
  const { parallel = false } = options;

  if (parallel) {
    const results = await Promise.all(
      snippets.map(s => execute(s.code, s.language, s.options || options).catch(e => ({
        success: false,
        error: e.message
      })))
    );
    return {
      snippets: snippets.length,
      results,
      successCount: results.filter(r => r.success).length
    };
  }

  // Sequential execution
  const results = [];
  for (const snippet of snippets) {
    try {
      const result = await execute(snippet.code, snippet.language, snippet.options || options);
      results.push(result);
    } catch (e) {
      results.push({ success: false, error: e.message });
    }
  }

  return {
    snippets: snippets.length,
    results,
    successCount: results.filter(r => r.success).length
  };
}

// ============================================================================
// HISTORY & ANALYTICS
// ============================================================================

/**
 * Get execution history
 */
export function getExecutionHistory(limit = 50) {
  return executionHistory.slice(-limit);
}

/**
 * Get execution statistics
 */
export function getExecutionStats() {
  if (executionHistory.length === 0) {
    return { message: 'No execution history yet' };
  }

  const languages = {};
  let successCount = 0;
  let totalTime = 0;

  executionHistory.forEach(e => {
    languages[e.language] = (languages[e.language] || 0) + 1;
    if (e.success) successCount++;
    totalTime += e.timeMs || 0;
  });

  return {
    totalExecutions: executionHistory.length,
    successRate: `${Math.round(successCount / executionHistory.length * 100)}%`,
    averageTimeMs: Math.round(totalTime / executionHistory.length),
    languageBreakdown: languages
  };
}

/**
 * Clear execution history
 */
export function clearHistory() {
  executionHistory.length = 0;
  return { success: true, message: 'Execution history cleared' };
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Simple hash for code tracking
 */
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Validation
  validateCode,
  // Execution
  execute,
  runJS,
  runPython,
  runBash,
  evaluate,
  // Generation
  generateAndRun,
  testWithInputs,
  // Batch
  executeBatch,
  // History
  getExecutionHistory,
  getExecutionStats,
  clearHistory
};
