// ============================================================================
// WORKFLOW AUTOMATION - Pipelines, Scheduling, Task Orchestration
// Automated workflow management and execution
// ============================================================================

import OpenAI from 'openai';

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ============================================================================
// WORKFLOW REGISTRY
// ============================================================================

const workflows = new Map();
const runHistory = [];
const scheduledTasks = new Map();

/**
 * Define a workflow
 */
export function defineWorkflow(name, config) {
  const workflow = {
    name,
    description: config.description || '',
    steps: config.steps || [],
    triggers: config.triggers || [],
    variables: config.variables || {},
    errorHandling: config.errorHandling || 'stop',
    timeout: config.timeout || 300000, // 5 min default
    createdAt: new Date().toISOString()
  };

  workflows.set(name, workflow);
  return workflow;
}

/**
 * Get workflow
 */
export function getWorkflow(name) {
  return workflows.get(name);
}

/**
 * List workflows
 */
export function listWorkflows() {
  return Array.from(workflows.values()).map(w => ({
    name: w.name,
    description: w.description,
    stepCount: w.steps.length,
    triggers: w.triggers.map(t => t.type)
  }));
}

// ============================================================================
// WORKFLOW EXECUTION
// ============================================================================

/**
 * Execute a workflow
 */
export async function executeWorkflow(name, input = {}, options = {}) {
  const workflow = workflows.get(name);
  if (!workflow) throw new Error(`Workflow '${name}' not found`);

  const runId = `run_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const run = {
    id: runId,
    workflow: name,
    status: 'running',
    startTime: new Date().toISOString(),
    input,
    steps: [],
    variables: { ...workflow.variables, ...input },
    output: null,
    error: null
  };

  runHistory.push(run);

  try {
    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      const stepResult = await executeStep(step, run.variables, options);

      run.steps.push({
        name: step.name,
        status: stepResult.success ? 'completed' : 'failed',
        startTime: stepResult.startTime,
        endTime: stepResult.endTime,
        duration: stepResult.duration,
        output: stepResult.output,
        error: stepResult.error
      });

      if (!stepResult.success) {
        if (workflow.errorHandling === 'stop') {
          throw new Error(`Step '${step.name}' failed: ${stepResult.error}`);
        } else if (workflow.errorHandling === 'skip') {
          continue;
        }
      }

      // Update variables with step output
      if (step.outputVar) {
        run.variables[step.outputVar] = stepResult.output;
      }
    }

    run.status = 'completed';
    run.output = run.variables;
  } catch (error) {
    run.status = 'failed';
    run.error = error.message;
  }

  run.endTime = new Date().toISOString();
  run.duration = new Date(run.endTime) - new Date(run.startTime);

  return run;
}

/**
 * Execute a single step
 */
async function executeStep(step, variables, options) {
  const startTime = new Date().toISOString();

  try {
    let output;

    // Resolve variable references in step config
    const resolvedConfig = resolveVariables(step.config || {}, variables);

    switch (step.type) {
      case 'function':
        if (typeof step.fn === 'function') {
          output = await step.fn(resolvedConfig, variables);
        }
        break;

      case 'http':
        output = await executeHttpStep(resolvedConfig);
        break;

      case 'condition':
        output = evaluateCondition(step.condition, variables);
        break;

      case 'loop':
        output = await executeLoopStep(step, variables, options);
        break;

      case 'parallel':
        output = await executeParallelSteps(step.steps, variables, options);
        break;

      case 'delay':
        await new Promise(resolve => setTimeout(resolve, step.ms || 1000));
        output = { delayed: step.ms };
        break;

      case 'ai':
        output = await executeAIStep(step, variables);
        break;

      default:
        output = { type: step.type, config: resolvedConfig };
    }

    const endTime = new Date().toISOString();
    return {
      success: true,
      output,
      startTime,
      endTime,
      duration: new Date(endTime) - new Date(startTime)
    };
  } catch (error) {
    const endTime = new Date().toISOString();
    return {
      success: false,
      error: error.message,
      startTime,
      endTime,
      duration: new Date(endTime) - new Date(startTime)
    };
  }
}

function resolveVariables(obj, variables) {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{(\w+)\}/g, (_, key) => variables[key] ?? '');
  }
  if (Array.isArray(obj)) {
    return obj.map(item => resolveVariables(item, variables));
  }
  if (typeof obj === 'object' && obj !== null) {
    const resolved = {};
    for (const [key, value] of Object.entries(obj)) {
      resolved[key] = resolveVariables(value, variables);
    }
    return resolved;
  }
  return obj;
}

async function executeHttpStep(config) {
  const response = await fetch(config.url, {
    method: config.method || 'GET',
    headers: config.headers || {},
    body: config.body ? JSON.stringify(config.body) : undefined
  });

  const data = await response.json().catch(() => response.text());
  return { status: response.status, data };
}

function evaluateCondition(condition, variables) {
  // Simple condition evaluation
  const { left, operator, right } = condition;
  const leftVal = variables[left] ?? left;
  const rightVal = variables[right] ?? right;

  switch (operator) {
    case '==': return leftVal == rightVal;
    case '===': return leftVal === rightVal;
    case '!=': return leftVal != rightVal;
    case '>': return leftVal > rightVal;
    case '<': return leftVal < rightVal;
    case '>=': return leftVal >= rightVal;
    case '<=': return leftVal <= rightVal;
    case 'contains': return String(leftVal).includes(String(rightVal));
    default: return false;
  }
}

async function executeLoopStep(step, variables, options) {
  const results = [];
  const items = variables[step.over] || step.items || [];

  for (const item of items) {
    const loopVars = { ...variables, [step.as || 'item']: item };
    for (const subStep of step.steps) {
      const result = await executeStep(subStep, loopVars, options);
      results.push(result);
    }
  }

  return results;
}

async function executeParallelSteps(steps, variables, options) {
  const results = await Promise.allSettled(
    steps.map(step => executeStep(step, variables, options))
  );

  return results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason.message });
}

async function executeAIStep(step, variables) {
  if (!openai) throw new Error('OpenAI required for AI steps');

  const prompt = resolveVariables(step.prompt, variables);

  const response = await openai.chat.completions.create({
    model: step.model || 'gpt-4o',
    messages: [
      { role: 'system', content: step.systemPrompt || 'You are a helpful assistant.' },
      { role: 'user', content: prompt }
    ],
    max_tokens: step.maxTokens || 1500
  });

  return response.choices[0].message.content;
}

// ============================================================================
// SCHEDULING
// ============================================================================

/**
 * Schedule a task
 */
export function scheduleTask(name, config) {
  const task = {
    name,
    workflow: config.workflow,
    input: config.input || {},
    schedule: config.schedule, // cron expression or interval
    enabled: config.enabled !== false,
    lastRun: null,
    nextRun: calculateNextRun(config.schedule),
    createdAt: new Date().toISOString()
  };

  scheduledTasks.set(name, task);

  // Set up interval if needed
  if (config.schedule.type === 'interval') {
    const interval = parseInterval(config.schedule.value);
    task.intervalId = setInterval(async () => {
      if (task.enabled) {
        task.lastRun = new Date().toISOString();
        await executeWorkflow(task.workflow, task.input);
        task.nextRun = new Date(Date.now() + interval).toISOString();
      }
    }, interval);
  }

  return task;
}

function parseInterval(value) {
  const match = value.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 60000; // default 1 minute

  const [, num, unit] = match;
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return parseInt(num) * multipliers[unit];
}

function calculateNextRun(schedule) {
  if (schedule.type === 'interval') {
    return new Date(Date.now() + parseInterval(schedule.value)).toISOString();
  }
  // For cron, would need cron parser
  return null;
}

/**
 * Cancel scheduled task
 */
export function cancelScheduledTask(name) {
  const task = scheduledTasks.get(name);
  if (!task) return { error: 'Task not found' };

  if (task.intervalId) {
    clearInterval(task.intervalId);
  }

  scheduledTasks.delete(name);
  return { cancelled: true, name };
}

/**
 * List scheduled tasks
 */
export function listScheduledTasks() {
  return Array.from(scheduledTasks.values()).map(t => ({
    name: t.name,
    workflow: t.workflow,
    schedule: t.schedule,
    enabled: t.enabled,
    lastRun: t.lastRun,
    nextRun: t.nextRun
  }));
}

// ============================================================================
// PIPELINE BUILDER
// ============================================================================

/**
 * Create a pipeline builder
 */
export function createPipeline(name) {
  return new PipelineBuilder(name);
}

class PipelineBuilder {
  constructor(name) {
    this.name = name;
    this.steps = [];
    this.variables = {};
    this.errorHandling = 'stop';
  }

  addStep(name, type, config) {
    this.steps.push({ name, type, config, outputVar: config.outputVar });
    return this;
  }

  addFunction(name, fn, config = {}) {
    return this.addStep(name, 'function', { ...config, fn });
  }

  addHttp(name, config) {
    return this.addStep(name, 'http', config);
  }

  addAI(name, prompt, config = {}) {
    return this.addStep(name, 'ai', { prompt, ...config });
  }

  addCondition(name, condition, config = {}) {
    return this.addStep(name, 'condition', { condition, ...config });
  }

  addLoop(name, over, steps, config = {}) {
    return this.addStep(name, 'loop', { over, steps, ...config });
  }

  addParallel(name, steps) {
    return this.addStep(name, 'parallel', { steps });
  }

  addDelay(name, ms) {
    return this.addStep(name, 'delay', { ms });
  }

  setVariables(vars) {
    this.variables = { ...this.variables, ...vars };
    return this;
  }

  onError(handling) {
    this.errorHandling = handling;
    return this;
  }

  build() {
    return defineWorkflow(this.name, {
      steps: this.steps,
      variables: this.variables,
      errorHandling: this.errorHandling
    });
  }

  async run(input = {}) {
    this.build();
    return executeWorkflow(this.name, input);
  }
}

// ============================================================================
// WORKFLOW TEMPLATES
// ============================================================================

/**
 * Create workflow from template
 */
export async function createFromTemplate(template, customization = {}) {
  if (!openai) throw new Error('OpenAI required');

  const templates = {
    'data-pipeline': {
      description: 'ETL data processing pipeline',
      steps: ['fetch', 'transform', 'validate', 'load']
    },
    'notification': {
      description: 'Multi-channel notification workflow',
      steps: ['prepare', 'send-email', 'send-slack', 'log']
    },
    'approval': {
      description: 'Multi-stage approval workflow',
      steps: ['submit', 'review', 'approve-reject', 'notify']
    },
    'report': {
      description: 'Automated report generation',
      steps: ['gather-data', 'analyze', 'generate-report', 'distribute']
    }
  };

  const templateConfig = templates[template];
  if (!templateConfig) {
    throw new Error(`Template '${template}' not found. Available: ${Object.keys(templates).join(', ')}`);
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Generate a detailed workflow configuration based on the template.
Return JSON:
{
  "name": "workflow name",
  "description": "what it does",
  "steps": [
    {"name": "step name", "type": "function/http/ai/condition/loop", "config": {...}, "outputVar": "varName"}
  ],
  "variables": {"var1": "default value"},
  "triggers": [{"type": "manual/schedule/webhook", "config": {...}}]
}`
      },
      {
        role: 'user',
        content: `Template: ${template}
Description: ${templateConfig.description}
Customization: ${JSON.stringify(customization)}`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  const config = JSON.parse(response.choices[0].message.content);
  return defineWorkflow(config.name, config);
}

// ============================================================================
// RUN HISTORY
// ============================================================================

/**
 * Get run history
 */
export function getRunHistory(options = {}) {
  const { workflow, status, limit = 50 } = options;

  let filtered = runHistory;

  if (workflow) {
    filtered = filtered.filter(r => r.workflow === workflow);
  }
  if (status) {
    filtered = filtered.filter(r => r.status === status);
  }

  return filtered.slice(-limit).reverse();
}

/**
 * Get run details
 */
export function getRunDetails(runId) {
  return runHistory.find(r => r.id === runId);
}

// ============================================================================
// WORKFLOW ANALYSIS
// ============================================================================

/**
 * Analyze workflow performance
 */
export async function analyzeWorkflowPerformance(workflowName, options = {}) {
  const runs = runHistory.filter(r => r.workflow === workflowName);

  if (runs.length === 0) {
    return { message: 'No runs found for this workflow' };
  }

  const completed = runs.filter(r => r.status === 'completed');
  const failed = runs.filter(r => r.status === 'failed');
  const durations = completed.map(r => r.duration).filter(d => d);

  const stepStats = {};
  completed.forEach(run => {
    run.steps.forEach(step => {
      if (!stepStats[step.name]) {
        stepStats[step.name] = { durations: [], failures: 0 };
      }
      stepStats[step.name].durations.push(step.duration);
      if (step.status === 'failed') stepStats[step.name].failures++;
    });
  });

  return {
    totalRuns: runs.length,
    completed: completed.length,
    failed: failed.length,
    successRate: (completed.length / runs.length) * 100,
    avgDuration: durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null,
    stepPerformance: Object.entries(stepStats).map(([name, stats]) => ({
      name,
      avgDuration: stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length,
      failureRate: (stats.failures / stats.durations.length) * 100
    })),
    bottleneck: Object.entries(stepStats)
      .sort((a, b) => {
        const avgA = a[1].durations.reduce((x, y) => x + y, 0) / a[1].durations.length;
        const avgB = b[1].durations.reduce((x, y) => x + y, 0) / b[1].durations.length;
        return avgB - avgA;
      })[0]?.[0] || null
  };
}

/**
 * Suggest workflow optimizations
 */
export async function suggestOptimizations(workflowName) {
  if (!openai) throw new Error('OpenAI required');

  const workflow = workflows.get(workflowName);
  const performance = await analyzeWorkflowPerformance(workflowName);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Analyze workflow and suggest optimizations.
Return JSON:
{
  "optimizations": [
    {
      "type": "parallelization/caching/batching/elimination/reordering",
      "description": "what to optimize",
      "expectedImprovement": "expected benefit",
      "implementation": "how to implement"
    }
  ],
  "parallelizableSteps": ["steps that could run in parallel"],
  "redundantSteps": ["steps that might be unnecessary"],
  "overallRecommendation": "main recommendation"
}`
      },
      {
        role: 'user',
        content: `Workflow: ${JSON.stringify(workflow)}
Performance: ${JSON.stringify(performance)}`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    workflowDefinition: true,
    workflowExecution: true,
    scheduling: true,
    pipelineBuilder: true,
    templates: true,
    analysis: !!openai,
    stats: {
      workflows: workflows.size,
      scheduledTasks: scheduledTasks.size,
      runHistory: runHistory.length
    },
    capabilities: [
      'workflow_definition', 'workflow_execution', 'workflow_listing',
      'step_execution', 'parallel_execution', 'loop_execution',
      'condition_evaluation', 'http_steps', 'ai_steps',
      'task_scheduling', 'interval_scheduling',
      'pipeline_builder', 'workflow_templates',
      'run_history', 'performance_analysis', 'optimization_suggestions'
    ],
    ready: true
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Workflow Management
  defineWorkflow, getWorkflow, listWorkflows,
  // Execution
  executeWorkflow,
  // Scheduling
  scheduleTask, cancelScheduledTask, listScheduledTasks,
  // Pipeline Builder
  createPipeline,
  // Templates
  createFromTemplate,
  // History
  getRunHistory, getRunDetails,
  // Analysis
  analyzeWorkflowPerformance, suggestOptimizations
};
