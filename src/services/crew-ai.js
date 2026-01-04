// ============================================================================
// CREWAI SERVICE - Multi-Agent Collaboration
// Spawn specialized agents that work together on complex tasks
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

// Crew execution history
const crewHistory = [];

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    multiAgent: true,
    hierarchicalProcess: true,
    sequentialProcess: true,
    parallelProcess: true,
    providers: {
      claude: !!anthropic,
      gpt: !!openai,
      gemini: !!gemini
    },
    crewsExecuted: crewHistory.length,
    ready: !!(openai || anthropic)
  };
}

// ============================================================================
// AGENT DEFINITIONS
// ============================================================================

/**
 * Pre-defined agent roles with specialized capabilities
 */
const AGENT_TEMPLATES = {
  researcher: {
    role: 'Researcher',
    goal: 'Find and gather relevant information comprehensively',
    backstory: 'Expert at finding information from multiple sources, synthesizing data, and identifying key insights.',
    preferredProvider: 'claude'
  },
  analyst: {
    role: 'Data Analyst',
    goal: 'Analyze data and identify patterns, trends, and insights',
    backstory: 'Expert at statistical analysis, pattern recognition, and data interpretation.',
    preferredProvider: 'gpt'
  },
  writer: {
    role: 'Technical Writer',
    goal: 'Create clear, concise, and well-structured content',
    backstory: 'Expert at transforming complex information into readable, actionable content.',
    preferredProvider: 'claude'
  },
  reviewer: {
    role: 'Quality Reviewer',
    goal: 'Ensure accuracy, completeness, and quality of work',
    backstory: 'Meticulous expert at finding errors, gaps, and areas for improvement.',
    preferredProvider: 'gpt'
  },
  planner: {
    role: 'Strategic Planner',
    goal: 'Create actionable plans and strategies',
    backstory: 'Expert at breaking down complex goals into achievable steps with clear dependencies.',
    preferredProvider: 'claude'
  },
  coder: {
    role: 'Software Developer',
    goal: 'Write clean, efficient, and working code',
    backstory: 'Expert programmer who writes well-tested, maintainable code.',
    preferredProvider: 'gpt'
  },
  debugger: {
    role: 'Debug Specialist',
    goal: 'Find and fix issues in code or processes',
    backstory: 'Expert at tracing problems to their root cause and implementing fixes.',
    preferredProvider: 'claude'
  },
  architect: {
    role: 'Solutions Architect',
    goal: 'Design robust, scalable solutions',
    backstory: 'Expert at system design, considering trade-offs and long-term implications.',
    preferredProvider: 'claude'
  },
  facilitator: {
    role: 'Team Facilitator',
    goal: 'Coordinate team efforts and synthesize outputs',
    backstory: 'Expert at managing collaboration, resolving conflicts, and ensuring alignment.',
    preferredProvider: 'gemini'
  },
  critic: {
    role: 'Devil\'s Advocate',
    goal: 'Challenge assumptions and find weaknesses',
    backstory: 'Expert at stress-testing ideas and identifying potential problems.',
    preferredProvider: 'gpt'
  }
};

/**
 * Create an agent from template or custom definition
 */
export function createAgent(config) {
  const template = typeof config === 'string' ? AGENT_TEMPLATES[config] : null;

  const agent = {
    id: `agent_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    role: config.role || template?.role || 'Assistant',
    goal: config.goal || template?.goal || 'Help complete the task',
    backstory: config.backstory || template?.backstory || '',
    preferredProvider: config.provider || template?.preferredProvider || 'claude',
    tools: config.tools || [],
    memory: [],
    outputs: []
  };

  return agent;
}

/**
 * Get available agent templates
 */
export function getAgentTemplates() {
  return Object.keys(AGENT_TEMPLATES).map(key => ({
    name: key,
    ...AGENT_TEMPLATES[key]
  }));
}

// ============================================================================
// CREW MANAGEMENT
// ============================================================================

/**
 * Create a new crew with agents and tasks
 */
export function createCrew(config) {
  const { name, agents, tasks, process = 'sequential', verbose = true } = config;

  const crew = {
    id: `crew_${Date.now()}`,
    name: name || 'Unnamed Crew',
    agents: agents.map(a => typeof a === 'string' ? createAgent(a) : createAgent(a)),
    tasks: tasks.map((t, i) => ({
      id: `task_${i}`,
      description: t.description || t,
      assignedAgent: t.agent || null,
      dependencies: t.dependencies || [],
      expectedOutput: t.expectedOutput || 'Completed task output',
      status: 'pending',
      result: null
    })),
    process,  // 'sequential', 'parallel', 'hierarchical'
    verbose,
    status: 'created',
    startedAt: null,
    completedAt: null,
    results: []
  };

  return crew;
}

// ============================================================================
// AI PROVIDER CALLS
// ============================================================================

async function callProvider(provider, prompt, systemPrompt = '') {
  const start = Date.now();

  if (provider === 'claude' && anthropic) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }]
    });
    return {
      content: response.content[0].text,
      provider: 'claude',
      timeMs: Date.now() - start
    };
  }

  if (provider === 'gpt' && openai) {
    const messages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }]
      : [{ role: 'user', content: prompt }];

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages
    });
    return {
      content: response.choices[0].message.content,
      provider: 'gpt',
      timeMs: Date.now() - start
    };
  }

  if (provider === 'gemini' && gemini) {
    const model = gemini.getGenerativeModel({ model: 'gemini-1.5-pro' });
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    const result = await model.generateContent(fullPrompt);
    return {
      content: result.response.text(),
      provider: 'gemini',
      timeMs: Date.now() - start
    };
  }

  // Fallback to any available
  if (anthropic) return callProvider('claude', prompt, systemPrompt);
  if (openai) return callProvider('gpt', prompt, systemPrompt);
  if (gemini) return callProvider('gemini', prompt, systemPrompt);

  throw new Error('No AI provider available');
}

// ============================================================================
// AGENT EXECUTION
// ============================================================================

/**
 * Have an agent execute a task
 */
async function executeAgentTask(agent, task, context = '') {
  const systemPrompt = `You are ${agent.role}.

YOUR GOAL: ${agent.goal}

BACKSTORY: ${agent.backstory}

IMPORTANT INSTRUCTIONS:
- Stay focused on your specific role and goal
- Provide thorough, actionable output
- Be concise but complete
- If you need information you don't have, say so clearly`;

  const taskPrompt = `TASK: ${task.description}

EXPECTED OUTPUT: ${task.expectedOutput}

${context ? `CONTEXT FROM PREVIOUS WORK:\n${context}` : ''}

Complete this task according to your role and goal.`;

  const response = await callProvider(agent.preferredProvider, taskPrompt, systemPrompt);

  // Store in agent memory
  agent.memory.push({
    task: task.id,
    input: task.description,
    output: response.content,
    timestamp: new Date().toISOString()
  });

  agent.outputs.push(response.content);

  return {
    agentId: agent.id,
    agentRole: agent.role,
    taskId: task.id,
    output: response.content,
    provider: response.provider,
    timeMs: response.timeMs
  };
}

// ============================================================================
// CREW EXECUTION PROCESSES
// ============================================================================

/**
 * Sequential process: Tasks execute one after another
 */
async function executeSequential(crew, onProgress) {
  const results = [];
  let context = '';

  for (let i = 0; i < crew.tasks.length; i++) {
    const task = crew.tasks[i];

    // Find assigned agent or use round-robin
    const agent = task.assignedAgent
      ? crew.agents.find(a => a.role.toLowerCase().includes(task.assignedAgent.toLowerCase()))
      : crew.agents[i % crew.agents.length];

    task.status = 'in_progress';
    if (onProgress) onProgress({ type: 'task_start', task, agent });

    const result = await executeAgentTask(agent, task, context);

    task.status = 'completed';
    task.result = result.output;
    results.push(result);

    // Build context from previous results
    context += `\n\n[${agent.role}]: ${result.output}`;

    if (onProgress) onProgress({ type: 'task_complete', task, result });
  }

  return results;
}

/**
 * Parallel process: All tasks execute simultaneously
 */
async function executeParallel(crew, onProgress) {
  if (onProgress) onProgress({ type: 'parallel_start', taskCount: crew.tasks.length });

  const promises = crew.tasks.map((task, i) => {
    const agent = task.assignedAgent
      ? crew.agents.find(a => a.role.toLowerCase().includes(task.assignedAgent.toLowerCase()))
      : crew.agents[i % crew.agents.length];

    task.status = 'in_progress';
    return executeAgentTask(agent, task, '');
  });

  const results = await Promise.all(promises);

  crew.tasks.forEach((task, i) => {
    task.status = 'completed';
    task.result = results[i].output;
  });

  if (onProgress) onProgress({ type: 'parallel_complete', results });

  return results;
}

/**
 * Hierarchical process: Manager delegates and synthesizes
 */
async function executeHierarchical(crew, onProgress) {
  // Create or find manager agent
  let manager = crew.agents.find(a =>
    a.role.toLowerCase().includes('manager') ||
    a.role.toLowerCase().includes('facilitator')
  );

  if (!manager) {
    manager = createAgent({
      role: 'Crew Manager',
      goal: 'Coordinate team efforts, delegate tasks, and synthesize results',
      backstory: 'Expert project manager who ensures team alignment and quality output.',
      provider: 'claude'
    });
    crew.agents.push(manager);
  }

  if (onProgress) onProgress({ type: 'manager_assigned', manager });

  // Step 1: Manager analyzes tasks and assigns to agents
  const delegationPrompt = `You are managing a team to complete a project.

TEAM MEMBERS:
${crew.agents.filter(a => a.id !== manager.id).map(a => `- ${a.role}: ${a.goal}`).join('\n')}

TASKS TO COMPLETE:
${crew.tasks.map((t, i) => `${i + 1}. ${t.description}`).join('\n')}

Create a delegation plan. For each task, specify which team member should handle it and what specific instructions they need.

Return as JSON:
{
  "delegations": [
    {"taskIndex": 0, "assignTo": "role name", "instructions": "specific guidance"}
  ],
  "executionOrder": "sequential" or "parallel",
  "coordinationNotes": "any dependencies or coordination needed"
}`;

  const delegationResult = await callProvider(manager.preferredProvider, delegationPrompt);

  let delegation;
  try {
    const jsonMatch = delegationResult.content.match(/\{[\s\S]*\}/);
    delegation = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch (e) {
    delegation = null;
  }

  if (onProgress) onProgress({ type: 'delegation_complete', delegation });

  // Step 2: Execute according to delegation
  const results = [];
  const agentOutputs = {};

  for (let i = 0; i < crew.tasks.length; i++) {
    const task = crew.tasks[i];
    const del = delegation?.delegations?.find(d => d.taskIndex === i);

    const agent = del
      ? crew.agents.find(a => a.role.toLowerCase().includes(del.assignTo.toLowerCase()))
      : crew.agents[i % crew.agents.length];

    if (!agent) continue;

    const enhancedTask = {
      ...task,
      description: del?.instructions
        ? `${task.description}\n\nMANAGER INSTRUCTIONS: ${del.instructions}`
        : task.description
    };

    task.status = 'in_progress';
    const result = await executeAgentTask(agent, enhancedTask, '');

    task.status = 'completed';
    task.result = result.output;
    results.push(result);
    agentOutputs[agent.role] = result.output;

    if (onProgress) onProgress({ type: 'task_complete', task, result });
  }

  // Step 3: Manager synthesizes all outputs
  const synthesisPrompt = `Your team has completed their assigned tasks. Review and synthesize their work.

TEAM OUTPUTS:
${Object.entries(agentOutputs).map(([role, output]) => `
=== ${role} ===
${output}
`).join('\n')}

Synthesize these outputs into a coherent final deliverable. Identify:
1. Key findings and conclusions
2. Any conflicts or gaps between team outputs
3. Recommended next steps
4. Overall quality assessment`;

  const synthesis = await callProvider(manager.preferredProvider, synthesisPrompt);

  results.push({
    agentId: manager.id,
    agentRole: 'Crew Manager (Synthesis)',
    taskId: 'synthesis',
    output: synthesis.content,
    provider: synthesis.provider,
    timeMs: synthesis.timeMs
  });

  if (onProgress) onProgress({ type: 'synthesis_complete', synthesis });

  return results;
}

// ============================================================================
// MAIN CREW EXECUTION
// ============================================================================

/**
 * Execute a crew's tasks
 */
export async function kickoff(crew, options = {}) {
  const { onProgress } = options;
  const startTime = Date.now();

  crew.status = 'running';
  crew.startedAt = new Date().toISOString();

  if (onProgress) onProgress({ type: 'crew_start', crew });

  try {
    let results;

    switch (crew.process) {
      case 'parallel':
        results = await executeParallel(crew, onProgress);
        break;
      case 'hierarchical':
        results = await executeHierarchical(crew, onProgress);
        break;
      case 'sequential':
      default:
        results = await executeSequential(crew, onProgress);
    }

    crew.status = 'completed';
    crew.completedAt = new Date().toISOString();
    crew.results = results;

    const execution = {
      crewId: crew.id,
      crewName: crew.name,
      process: crew.process,
      agentCount: crew.agents.length,
      taskCount: crew.tasks.length,
      results,
      totalTimeMs: Date.now() - startTime,
      startedAt: crew.startedAt,
      completedAt: crew.completedAt
    };

    // Store in history
    crewHistory.push(execution);
    if (crewHistory.length > 100) crewHistory.shift();

    if (onProgress) onProgress({ type: 'crew_complete', execution });

    return execution;

  } catch (error) {
    crew.status = 'failed';
    crew.error = error.message;
    throw error;
  }
}

// ============================================================================
// QUICK CREW TEMPLATES
// ============================================================================

/**
 * Research crew: Researcher + Analyst + Writer + Reviewer
 */
export async function researchCrew(topic, options = {}) {
  const crew = createCrew({
    name: `Research: ${topic.substring(0, 30)}`,
    agents: ['researcher', 'analyst', 'writer', 'reviewer'],
    tasks: [
      { description: `Research and gather comprehensive information about: ${topic}`, expectedOutput: 'Detailed research findings with sources' },
      { description: 'Analyze the research findings to identify key patterns, insights, and implications', expectedOutput: 'Analysis with key insights' },
      { description: 'Write a clear, well-structured report summarizing the findings and analysis', expectedOutput: 'Complete written report' },
      { description: 'Review the report for accuracy, completeness, and quality. Suggest improvements.', expectedOutput: 'Quality review with improvements' }
    ],
    process: options.process || 'sequential'
  });

  return kickoff(crew, options);
}

/**
 * Coding crew: Architect + Coder + Reviewer + Debugger
 */
export async function codingCrew(task, options = {}) {
  const crew = createCrew({
    name: `Coding: ${task.substring(0, 30)}`,
    agents: ['architect', 'coder', 'reviewer', 'debugger'],
    tasks: [
      { description: `Design the architecture and approach for: ${task}`, expectedOutput: 'Architecture design with approach' },
      { description: 'Implement the code based on the architectural design', expectedOutput: 'Working code implementation' },
      { description: 'Review the code for quality, security, and best practices', expectedOutput: 'Code review with suggestions' },
      { description: 'Identify and fix any issues or bugs in the implementation', expectedOutput: 'Debugged, working solution' }
    ],
    process: options.process || 'sequential'
  });

  return kickoff(crew, options);
}

/**
 * Planning crew: Planner + Critic + Facilitator
 */
export async function planningCrew(goal, options = {}) {
  const crew = createCrew({
    name: `Planning: ${goal.substring(0, 30)}`,
    agents: ['planner', 'critic', 'facilitator'],
    tasks: [
      { description: `Create a detailed plan to achieve: ${goal}`, expectedOutput: 'Step-by-step action plan' },
      { description: 'Challenge the plan - identify weaknesses, risks, and alternatives', expectedOutput: 'Critical analysis with risks' },
      { description: 'Synthesize feedback into an improved, actionable final plan', expectedOutput: 'Final optimized plan' }
    ],
    process: options.process || 'hierarchical'
  });

  return kickoff(crew, options);
}

/**
 * Analysis crew: Researcher + Analyst + Critic
 */
export async function analysisCrew(question, data = '', options = {}) {
  const crew = createCrew({
    name: `Analysis: ${question.substring(0, 30)}`,
    agents: ['researcher', 'analyst', 'critic'],
    tasks: [
      { description: `Gather relevant context and information for: ${question}${data ? `\n\nData provided: ${data}` : ''}`, expectedOutput: 'Contextual information' },
      { description: 'Perform deep analysis to answer the question with evidence', expectedOutput: 'Detailed analysis with conclusions' },
      { description: 'Validate the analysis - check assumptions, methodology, and conclusions', expectedOutput: 'Validated analysis with confidence assessment' }
    ],
    process: options.process || 'sequential'
  });

  return kickoff(crew, options);
}

// ============================================================================
// HISTORY & STATS
// ============================================================================

/**
 * Get crew execution history
 */
export function getCrewHistory(limit = 20) {
  return crewHistory.slice(-limit);
}

/**
 * Get crew statistics
 */
export function getCrewStats() {
  if (crewHistory.length === 0) {
    return { message: 'No crew executions yet' };
  }

  const totalTime = crewHistory.reduce((sum, c) => sum + c.totalTimeMs, 0);
  const avgTime = totalTime / crewHistory.length;

  const processCounts = {};
  crewHistory.forEach(c => {
    processCounts[c.process] = (processCounts[c.process] || 0) + 1;
  });

  return {
    totalExecutions: crewHistory.length,
    averageTimeMs: Math.round(avgTime),
    totalAgentsUsed: crewHistory.reduce((sum, c) => sum + c.agentCount, 0),
    totalTasksCompleted: crewHistory.reduce((sum, c) => sum + c.taskCount, 0),
    processBreakdown: processCounts
  };
}

/**
 * Clear crew history
 */
export function clearHistory() {
  crewHistory.length = 0;
  return { success: true, message: 'Crew history cleared' };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Agent management
  createAgent,
  getAgentTemplates,
  // Crew management
  createCrew,
  kickoff,
  // Quick crews
  researchCrew,
  codingCrew,
  planningCrew,
  analysisCrew,
  // History
  getCrewHistory,
  getCrewStats,
  clearHistory
};
