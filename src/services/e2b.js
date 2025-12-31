// ============================================================================
// E2B CODE EXECUTION SERVICE
// Secure sandboxed code execution for AI-generated code
// ============================================================================

import fetch from 'node-fetch';

const E2B_API_URL = 'https://api.e2b.dev/v1';
let apiKey = null;

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initE2B() {
  apiKey = process.env.E2B_API_KEY;
  if (!apiKey) {
    console.log('[E2B] Not configured - E2B_API_KEY required');
    return false;
  }
  console.log('[E2B] Code execution sandbox ready');
  return true;
}

// ============================================================================
// SANDBOX MANAGEMENT
// ============================================================================

/**
 * Create a new sandbox environment
 */
export async function createSandbox(template = 'base') {
  if (!apiKey) initE2B();
  if (!apiKey) throw new Error('E2B not configured');

  const response = await fetch(`${E2B_API_URL}/sandboxes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify({ template })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create sandbox: ${error}`);
  }

  return response.json();
}

/**
 * Kill a sandbox
 */
export async function killSandbox(sandboxId) {
  if (!apiKey) throw new Error('E2B not configured');

  const response = await fetch(`${E2B_API_URL}/sandboxes/${sandboxId}`, {
    method: 'DELETE',
    headers: { 'X-API-Key': apiKey }
  });

  return response.ok;
}

// ============================================================================
// CODE EXECUTION
// ============================================================================

/**
 * Execute Python code in sandbox
 */
export async function executePython(code, timeout = 30000) {
  if (!apiKey) initE2B();
  if (!apiKey) throw new Error('E2B not configured');

  const startTime = Date.now();

  try {
    // Create sandbox
    const sandbox = await createSandbox('python');
    const sandboxId = sandbox.sandboxId;

    try {
      // Execute code
      const response = await fetch(`${E2B_API_URL}/sandboxes/${sandboxId}/executions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify({
          code,
          language: 'python'
        })
      });

      const result = await response.json();

      return {
        success: !result.error,
        output: result.stdout || '',
        error: result.stderr || result.error || null,
        executionTime: Date.now() - startTime,
        sandboxId
      };
    } finally {
      // Always cleanup
      await killSandbox(sandboxId).catch(() => {});
    }
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error.message,
      executionTime: Date.now() - startTime
    };
  }
}

/**
 * Execute JavaScript/Node.js code in sandbox
 */
export async function executeJavaScript(code, timeout = 30000) {
  if (!apiKey) initE2B();
  if (!apiKey) throw new Error('E2B not configured');

  const startTime = Date.now();

  try {
    const sandbox = await createSandbox('nodejs');
    const sandboxId = sandbox.sandboxId;

    try {
      const response = await fetch(`${E2B_API_URL}/sandboxes/${sandboxId}/executions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify({
          code,
          language: 'javascript'
        })
      });

      const result = await response.json();

      return {
        success: !result.error,
        output: result.stdout || '',
        error: result.stderr || result.error || null,
        executionTime: Date.now() - startTime,
        sandboxId
      };
    } finally {
      await killSandbox(sandboxId).catch(() => {});
    }
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error.message,
      executionTime: Date.now() - startTime
    };
  }
}

/**
 * Execute shell command in sandbox
 */
export async function executeShell(command, timeout = 30000) {
  if (!apiKey) initE2B();
  if (!apiKey) throw new Error('E2B not configured');

  const startTime = Date.now();

  try {
    const sandbox = await createSandbox('base');
    const sandboxId = sandbox.sandboxId;

    try {
      const response = await fetch(`${E2B_API_URL}/sandboxes/${sandboxId}/commands`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify({ command })
      });

      const result = await response.json();

      return {
        success: result.exitCode === 0,
        output: result.stdout || '',
        error: result.stderr || null,
        exitCode: result.exitCode,
        executionTime: Date.now() - startTime,
        sandboxId
      };
    } finally {
      await killSandbox(sandboxId).catch(() => {});
    }
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error.message,
      executionTime: Date.now() - startTime
    };
  }
}

// ============================================================================
// DATA ANALYSIS
// ============================================================================

/**
 * Run pandas data analysis
 */
export async function analyzeData(data, analysisCode) {
  const fullCode = `
import pandas as pd
import json

# Load data
data = json.loads('''${JSON.stringify(data)}''')
df = pd.DataFrame(data)

# Run analysis
${analysisCode}
`;

  return executePython(fullCode);
}

/**
 * Generate visualization
 */
export async function generateChart(data, chartCode) {
  const fullCode = `
import pandas as pd
import matplotlib.pyplot as plt
import json
import base64
from io import BytesIO

# Load data
data = json.loads('''${JSON.stringify(data)}''')
df = pd.DataFrame(data)

# Create chart
${chartCode}

# Save to base64
buffer = BytesIO()
plt.savefig(buffer, format='png', bbox_inches='tight')
buffer.seek(0)
img_base64 = base64.b64encode(buffer.read()).decode()
print(f"IMAGE_BASE64:{img_base64}")
plt.close()
`;

  const result = await executePython(fullCode);

  if (result.success && result.output.includes('IMAGE_BASE64:')) {
    const base64Match = result.output.match(/IMAGE_BASE64:([A-Za-z0-9+/=]+)/);
    if (base64Match) {
      result.image = base64Match[1];
    }
  }

  return result;
}

// ============================================================================
// AI CODE VALIDATION
// ============================================================================

/**
 * Validate AI-generated code before production use
 */
export async function validateCode(code, language = 'python', testCases = []) {
  const results = {
    syntax: false,
    runs: false,
    tests: [],
    output: null,
    error: null
  };

  // Execute the code
  const execFn = language === 'javascript' ? executeJavaScript : executePython;
  const execResult = await execFn(code);

  results.syntax = !execResult.error?.includes('SyntaxError');
  results.runs = execResult.success;
  results.output = execResult.output;
  results.error = execResult.error;

  // Run test cases if provided
  for (const test of testCases) {
    const testCode = language === 'python'
      ? `${code}\n\n# Test\nassert ${test.assertion}, "${test.name}"\nprint("PASS: ${test.name}")`
      : `${code}\n\n// Test\nif (!(${test.assertion})) throw new Error("${test.name}");\nconsole.log("PASS: ${test.name}");`;

    const testResult = await execFn(testCode);
    results.tests.push({
      name: test.name,
      passed: testResult.success && testResult.output.includes(`PASS: ${test.name}`),
      output: testResult.output,
      error: testResult.error
    });
  }

  return results;
}

/**
 * Execute and explain code step by step
 */
export async function executeWithExplanation(code, language = 'python') {
  // First validate
  const validation = await validateCode(code, language);

  if (!validation.runs) {
    return {
      success: false,
      error: validation.error,
      explanation: `Code failed to execute: ${validation.error}`
    };
  }

  // If it runs, get the output
  return {
    success: true,
    output: validation.output,
    explanation: `Code executed successfully.\nOutput:\n${validation.output}`
  };
}

// ============================================================================
// FILE OPERATIONS IN SANDBOX
// ============================================================================

/**
 * Write file to sandbox and execute
 */
export async function executeWithFiles(code, files = [], language = 'python') {
  if (!apiKey) initE2B();
  if (!apiKey) throw new Error('E2B not configured');

  const sandbox = await createSandbox(language === 'javascript' ? 'nodejs' : 'python');
  const sandboxId = sandbox.sandboxId;

  try {
    // Write files
    for (const file of files) {
      await fetch(`${E2B_API_URL}/sandboxes/${sandboxId}/files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify({
          path: file.path,
          content: file.content
        })
      });
    }

    // Execute code
    const response = await fetch(`${E2B_API_URL}/sandboxes/${sandboxId}/executions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify({ code, language })
    });

    return response.json();
  } finally {
    await killSandbox(sandboxId).catch(() => {});
  }
}

// ============================================================================
// INSTALL PACKAGES
// ============================================================================

/**
 * Install packages and execute code
 */
export async function executeWithPackages(code, packages = [], language = 'python') {
  if (!apiKey) initE2B();
  if (!apiKey) throw new Error('E2B not configured');

  const sandbox = await createSandbox(language === 'javascript' ? 'nodejs' : 'python');
  const sandboxId = sandbox.sandboxId;

  try {
    // Install packages
    const installCmd = language === 'javascript'
      ? `npm install ${packages.join(' ')}`
      : `pip install ${packages.join(' ')}`;

    await fetch(`${E2B_API_URL}/sandboxes/${sandboxId}/commands`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify({ command: installCmd })
    });

    // Execute code
    const response = await fetch(`${E2B_API_URL}/sandboxes/${sandboxId}/executions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify({ code, language })
    });

    return response.json();
  } finally {
    await killSandbox(sandboxId).catch(() => {});
  }
}

// ============================================================================
// STATUS
// ============================================================================

export function getE2BStatus() {
  return {
    configured: !!apiKey || !!process.env.E2B_API_KEY,
    ready: !!apiKey
  };
}

export default {
  initE2B,
  createSandbox,
  killSandbox,
  executePython,
  executeJavaScript,
  executeShell,
  analyzeData,
  generateChart,
  validateCode,
  executeWithExplanation,
  executeWithFiles,
  executeWithPackages,
  getE2BStatus
};
