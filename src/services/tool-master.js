// ============================================================================
// TOOL MASTER SERVICE - Dynamic Tool Selection & Chaining
// Intelligently selects and chains tools to complete tasks
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

// Execution history
const executionHistory = [];

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    dynamicToolSelection: true,
    toolChaining: true,
    parallelExecution: true,
    errorRecovery: true,
    executionCount: executionHistory.length,
    toolRegistry: Object.keys(TOOL_REGISTRY).length,
    ready: !!(openai || anthropic)
  };
}

// ============================================================================
// TOOL REGISTRY
// Maps tool names to their capabilities and execution info
// ============================================================================

const TOOL_REGISTRY = {
  // AI Providers
  'ai.claude': {
    category: 'ai',
    description: 'Claude AI - Best for reasoning, analysis, and nuanced tasks',
    capabilities: ['reasoning', 'analysis', 'writing', 'coding', 'planning'],
    inputType: 'text',
    outputType: 'text'
  },
  'ai.gpt': {
    category: 'ai',
    description: 'GPT-4 - Great for coding, structured output, and broad knowledge',
    capabilities: ['coding', 'structured_output', 'general_knowledge', 'math'],
    inputType: 'text',
    outputType: 'text'
  },
  'ai.gemini': {
    category: 'ai',
    description: 'Gemini - Strong at multimodal and web-grounded tasks',
    capabilities: ['multimodal', 'web_search', 'synthesis'],
    inputType: 'text',
    outputType: 'text'
  },

  // Memory Systems
  'memory.memgpt': {
    category: 'memory',
    description: 'Hierarchical self-managing memory (core/working/archival)',
    capabilities: ['recall', 'store', 'context_building', 'self_manage'],
    inputType: 'text',
    outputType: 'json'
  },
  'memory.pinecone': {
    category: 'memory',
    description: 'Vector search for semantic similarity',
    capabilities: ['semantic_search', 'embeddings', 'similarity'],
    inputType: 'text',
    outputType: 'json'
  },
  'memory.neo4j': {
    category: 'memory',
    description: 'Knowledge graph for entity relationships',
    capabilities: ['graph_query', 'relationships', 'entity_search'],
    inputType: 'query',
    outputType: 'json'
  },

  // Reasoning
  'reasoning.tot': {
    category: 'reasoning',
    description: 'Tree-of-Thought parallel reasoning with backtracking',
    capabilities: ['parallel_reasoning', 'exploration', 'problem_solving'],
    inputType: 'text',
    outputType: 'json'
  },
  'reasoning.reflexion': {
    category: 'reasoning',
    description: 'Self-critique and iterative improvement',
    capabilities: ['self_critique', 'improvement', 'verification'],
    inputType: 'text',
    outputType: 'json'
  },

  // Research & Grounding
  'research.web': {
    category: 'research',
    description: 'Web search for current information',
    capabilities: ['web_search', 'current_events', 'fact_check'],
    inputType: 'query',
    outputType: 'json'
  },
  'research.scientific': {
    category: 'research',
    description: 'Scientific paper and research search',
    capabilities: ['arxiv', 'pubmed', 'academic_search'],
    inputType: 'query',
    outputType: 'json'
  },
  'research.firecrawl': {
    category: 'research',
    description: 'Web scraping and content extraction',
    capabilities: ['scraping', 'extraction', 'crawling'],
    inputType: 'url',
    outputType: 'json'
  },

  // Code & Execution
  'code.e2b': {
    category: 'code',
    description: 'Sandboxed code execution',
    capabilities: ['python', 'javascript', 'code_execution', 'data_analysis'],
    inputType: 'code',
    outputType: 'json'
  },
  'code.codegen': {
    category: 'code',
    description: 'AI code generation',
    capabilities: ['code_generation', 'refactoring', 'debugging'],
    inputType: 'text',
    outputType: 'code'
  },

  // GitHub
  'github.repos': {
    category: 'github',
    description: 'GitHub repository operations',
    capabilities: ['list_repos', 'read_files', 'search_code'],
    inputType: 'query',
    outputType: 'json'
  },
  'github.commits': {
    category: 'github',
    description: 'Create commits and manage files',
    capabilities: ['create_commit', 'update_file', 'create_branch'],
    inputType: 'json',
    outputType: 'json'
  },

  // Analysis
  'analysis.vision': {
    category: 'analysis',
    description: 'Image and visual analysis',
    capabilities: ['image_analysis', 'ocr', 'object_detection'],
    inputType: 'image',
    outputType: 'json'
  },
  'analysis.documents': {
    category: 'analysis',
    description: 'Document parsing and analysis',
    capabilities: ['pdf', 'docx', 'text_extraction'],
    inputType: 'document',
    outputType: 'json'
  },
  'analysis.data': {
    category: 'analysis',
    description: 'Data analysis and visualization',
    capabilities: ['statistics', 'trends', 'visualization'],
    inputType: 'data',
    outputType: 'json'
  },

  // Communication
  'comm.slack': {
    category: 'communication',
    description: 'Slack messaging',
    capabilities: ['send_message', 'read_channel'],
    inputType: 'json',
    outputType: 'json'
  },
  'comm.email': {
    category: 'communication',
    description: 'Email operations',
    capabilities: ['send_email', 'read_email', 'search_email'],
    inputType: 'json',
    outputType: 'json'
  },

  // Math & Calculation
  'math.wolfram': {
    category: 'math',
    description: 'Wolfram Alpha computational intelligence',
    capabilities: ['calculation', 'equations', 'unit_conversion', 'knowledge'],
    inputType: 'query',
    outputType: 'json'
  },
  'math.symbolic': {
    category: 'math',
    description: 'Symbolic mathematics and logic',
    capabilities: ['symbolic_math', 'logic', 'proofs'],
    inputType: 'expression',
    outputType: 'json'
  }
};

// ============================================================================
// TOOL SELECTION
// ============================================================================

/**
 * Select the best tools for a given task
 */
export async function selectTools(task, options = {}) {
  const { maxTools = 5, preferredCategories = [] } = options;

  if (!anthropic && !openai) {
    return selectToolsHeuristic(task, maxTools);
  }

  const toolDescriptions = Object.entries(TOOL_REGISTRY)
    .map(([name, info]) => `- ${name}: ${info.description}`)
    .join('\n');

  const prompt = `Select the best tools to complete this task.

TASK: ${task}

AVAILABLE TOOLS:
${toolDescriptions}

Requirements:
1. Select 1-${maxTools} tools that would be most useful
2. Order them by execution sequence
3. Explain why each tool is needed

Return JSON:
{
  "selectedTools": [
    {
      "tool": "tool.name",
      "purpose": "why this tool is needed",
      "input": "what to pass to this tool",
      "order": 1
    }
  ],
  "chainType": "sequential" | "parallel" | "mixed",
  "reasoning": "overall strategy explanation"
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
      const selection = JSON.parse(jsonMatch[0]);

      // Validate selected tools exist
      selection.selectedTools = selection.selectedTools.filter(
        t => TOOL_REGISTRY[t.tool]
      );

      return selection;
    }
  } catch (e) {
    // Fallback
  }

  return selectToolsHeuristic(task, maxTools);
}

/**
 * Heuristic-based tool selection
 */
function selectToolsHeuristic(task, maxTools = 5) {
  const taskLower = task.toLowerCase();
  const selectedTools = [];

  // Keyword-based selection
  const keywordMatches = {
    'search': ['research.web', 'memory.pinecone'],
    'code': ['code.codegen', 'code.e2b'],
    'analyze': ['analysis.data', 'ai.claude'],
    'research': ['research.web', 'research.scientific'],
    'image': ['analysis.vision'],
    'document': ['analysis.documents'],
    'calculate': ['math.wolfram', 'math.symbolic'],
    'github': ['github.repos', 'github.commits'],
    'remember': ['memory.memgpt', 'memory.pinecone'],
    'reason': ['reasoning.tot', 'reasoning.reflexion'],
    'email': ['comm.email'],
    'slack': ['comm.slack']
  };

  for (const [keyword, tools] of Object.entries(keywordMatches)) {
    if (taskLower.includes(keyword)) {
      tools.forEach(t => {
        if (!selectedTools.find(s => s.tool === t)) {
          selectedTools.push({
            tool: t,
            purpose: `Matches keyword: ${keyword}`,
            order: selectedTools.length + 1
          });
        }
      });
    }
  }

  // Always include at least one AI
  if (!selectedTools.find(s => s.tool.startsWith('ai.'))) {
    selectedTools.unshift({
      tool: 'ai.claude',
      purpose: 'Primary AI reasoning',
      order: 0
    });
  }

  return {
    selectedTools: selectedTools.slice(0, maxTools),
    chainType: 'sequential',
    reasoning: 'Heuristic selection based on keywords'
  };
}

// ============================================================================
// TOOL CHAINING
// ============================================================================

/**
 * Create a tool chain for complex task execution
 */
export async function createChain(task, options = {}) {
  const selection = await selectTools(task, options);

  const chain = {
    id: `chain_${Date.now()}`,
    task,
    tools: selection.selectedTools.map((t, i) => ({
      ...t,
      id: `step_${i}`,
      status: 'pending',
      result: null,
      error: null
    })),
    chainType: selection.chainType,
    reasoning: selection.reasoning,
    status: 'created',
    createdAt: new Date().toISOString()
  };

  return chain;
}

/**
 * Plan tool execution with dependencies
 */
export async function planExecution(task, tools = null) {
  const selectedTools = tools || (await selectTools(task)).selectedTools;

  if (!anthropic && !openai) {
    return {
      steps: selectedTools.map((t, i) => ({
        ...t,
        id: i,
        dependencies: i > 0 ? [i - 1] : []
      })),
      parallelGroups: [[...Array(selectedTools.length).keys()]]
    };
  }

  const prompt = `Plan the execution of these tools to complete a task.

TASK: ${task}

TOOLS TO USE:
${selectedTools.map((t, i) => `${i}. ${t.tool}: ${t.purpose}`).join('\n')}

Determine:
1. Which tools can run in parallel (no dependencies on each other)
2. Which tools must run sequentially (output of one feeds into another)
3. Optimal execution order

Return JSON:
{
  "steps": [
    {
      "id": 0,
      "tool": "tool.name",
      "dependencies": [],
      "inputFrom": null,
      "parallel": true
    }
  ],
  "parallelGroups": [[0, 1], [2, 3]],
  "estimatedTimeMs": number,
  "strategy": "explanation"
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
    // Fallback
  }

  return {
    steps: selectedTools.map((t, i) => ({
      id: i,
      tool: t.tool,
      dependencies: i > 0 ? [i - 1] : [],
      parallel: false
    })),
    parallelGroups: selectedTools.map((_, i) => [i]),
    strategy: 'Sequential fallback'
  };
}

// ============================================================================
// EXECUTION (Simulated - actual execution would call real services)
// ============================================================================

/**
 * Execute a tool chain
 * Note: This is a simulation - real execution would import and call actual services
 */
export async function executeChain(chain, context = {}) {
  const startTime = Date.now();
  chain.status = 'running';
  chain.startedAt = new Date().toISOString();

  const results = [];
  let accumulatedContext = { ...context };

  for (const step of chain.tools) {
    step.status = 'running';

    try {
      // Simulate tool execution
      const result = await simulateToolExecution(step.tool, step.input || chain.task, accumulatedContext);

      step.status = 'completed';
      step.result = result;
      results.push({
        stepId: step.id,
        tool: step.tool,
        result,
        timeMs: Date.now() - startTime
      });

      // Add result to context for next step
      accumulatedContext[step.tool] = result;

    } catch (error) {
      step.status = 'failed';
      step.error = error.message;

      // Try to recover or continue
      results.push({
        stepId: step.id,
        tool: step.tool,
        error: error.message,
        timeMs: Date.now() - startTime
      });
    }
  }

  chain.status = 'completed';
  chain.completedAt = new Date().toISOString();
  chain.results = results;
  chain.totalTimeMs = Date.now() - startTime;

  // Store in history
  executionHistory.push({
    chainId: chain.id,
    task: chain.task,
    toolsUsed: chain.tools.map(t => t.tool),
    success: chain.tools.every(t => t.status === 'completed'),
    totalTimeMs: chain.totalTimeMs,
    timestamp: chain.completedAt
  });

  if (executionHistory.length > 200) executionHistory.shift();

  return chain;
}

/**
 * Simulate tool execution (placeholder for actual service calls)
 */
async function simulateToolExecution(toolName, input, context) {
  const tool = TOOL_REGISTRY[toolName];
  if (!tool) throw new Error(`Unknown tool: ${toolName}`);

  // For AI tools, actually call them
  if (toolName === 'ai.claude' && anthropic) {
    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: typeof input === 'string' ? input : JSON.stringify(input) }]
    });
    return result.content[0].text;
  }

  if (toolName === 'ai.gpt' && openai) {
    const result = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: typeof input === 'string' ? input : JSON.stringify(input) }]
    });
    return result.choices[0].message.content;
  }

  // For other tools, return simulation response
  return {
    tool: toolName,
    simulated: true,
    input: typeof input === 'string' ? input.substring(0, 100) : input,
    message: `Tool ${toolName} would process: ${typeof input === 'string' ? input.substring(0, 50) : 'structured input'}`,
    capabilities: tool.capabilities
  };
}

// ============================================================================
// QUICK EXECUTION
// ============================================================================

/**
 * Quick execute: Select tools and run in one step
 */
export async function quickExecute(task, options = {}) {
  const chain = await createChain(task, options);
  return executeChain(chain, options.context || {});
}

/**
 * Execute with specific tools
 */
export async function executeWithTools(task, toolNames, options = {}) {
  const chain = {
    id: `chain_${Date.now()}`,
    task,
    tools: toolNames.map((name, i) => ({
      id: `step_${i}`,
      tool: name,
      purpose: TOOL_REGISTRY[name]?.description || 'Custom tool',
      order: i,
      status: 'pending',
      result: null
    })),
    chainType: 'sequential',
    status: 'created'
  };

  return executeChain(chain, options.context || {});
}

// ============================================================================
// TOOL DISCOVERY
// ============================================================================

/**
 * Get all available tools
 */
export function getAvailableTools() {
  return Object.entries(TOOL_REGISTRY).map(([name, info]) => ({
    name,
    ...info
  }));
}

/**
 * Get tools by category
 */
export function getToolsByCategory(category) {
  return Object.entries(TOOL_REGISTRY)
    .filter(([_, info]) => info.category === category)
    .map(([name, info]) => ({ name, ...info }));
}

/**
 * Get tools by capability
 */
export function getToolsByCapability(capability) {
  return Object.entries(TOOL_REGISTRY)
    .filter(([_, info]) => info.capabilities.includes(capability))
    .map(([name, info]) => ({ name, ...info }));
}

/**
 * Search tools by query
 */
export function searchTools(query) {
  const queryLower = query.toLowerCase();
  return Object.entries(TOOL_REGISTRY)
    .filter(([name, info]) =>
      name.toLowerCase().includes(queryLower) ||
      info.description.toLowerCase().includes(queryLower) ||
      info.capabilities.some(c => c.includes(queryLower))
    )
    .map(([name, info]) => ({ name, ...info }));
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

  const toolUsage = {};
  let totalTime = 0;
  let successCount = 0;

  executionHistory.forEach(e => {
    e.toolsUsed.forEach(t => {
      toolUsage[t] = (toolUsage[t] || 0) + 1;
    });
    totalTime += e.totalTimeMs;
    if (e.success) successCount++;
  });

  return {
    totalExecutions: executionHistory.length,
    successRate: `${Math.round(successCount / executionHistory.length * 100)}%`,
    averageTimeMs: Math.round(totalTime / executionHistory.length),
    toolUsage,
    mostUsedTool: Object.entries(toolUsage).sort((a, b) => b[1] - a[1])[0]?.[0]
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
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Tool selection
  selectTools,
  // Chaining
  createChain,
  planExecution,
  executeChain,
  // Quick execution
  quickExecute,
  executeWithTools,
  // Discovery
  getAvailableTools,
  getToolsByCategory,
  getToolsByCapability,
  searchTools,
  // History
  getExecutionHistory,
  getExecutionStats,
  clearHistory
};
