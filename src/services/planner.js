/**
 * HIERARCHICAL TASK PLANNER
 *
 * Break complex goals into executable sub-tasks:
 * - Goal decomposition
 * - Dependency resolution
 * - Resource allocation
 * - Parallel execution planning
 * - Progress tracking
 */

import * as db from '../db/index.js';
import * as aiProviders from './ai-providers.js';

// ============================================================================
// GOAL DECOMPOSITION
// ============================================================================

/**
 * Decompose a high-level goal into sub-tasks
 */
export async function decomposeGoal(goal, options = {}) {
  const { maxDepth = 3, context = {} } = options;

  const prompt = `Decompose this goal into a hierarchical task tree.

Goal: "${goal}"

Context: ${JSON.stringify(context)}

Return JSON with this structure:
{
  "goal": "original goal",
  "tasks": [
    {
      "id": "1",
      "name": "task name",
      "description": "what needs to be done",
      "type": "action|decision|verification|research",
      "estimatedMinutes": 15,
      "dependencies": [],
      "subtasks": [],
      "parallelizable": true,
      "requiredResources": ["resource1"],
      "priority": "high|medium|low"
    }
  ]
}

Rules:
- Max ${maxDepth} levels of nesting
- Each task should be actionable or decomposable
- Include time estimates
- Identify dependencies between tasks`;

  try {
    const response = await aiProviders.chat('claude', prompt);
    const parsed = JSON.parse(response.response.match(/\{[\s\S]*\}/)?.[0] || '{}');

    // Validate and enhance
    if (parsed.tasks) {
      assignExecutionOrder(parsed.tasks);
    }

    return {
      ...parsed,
      metadata: {
        decomposedAt: new Date().toISOString(),
        model: 'claude'
      }
    };
  } catch (e) {
    return {
      goal,
      error: e.message,
      tasks: []
    };
  }
}

/**
 * Assign execution order based on dependencies
 */
function assignExecutionOrder(tasks, order = { current: 1 }) {
  // Topological sort
  const visited = new Set();
  const result = [];

  function visit(task) {
    if (visited.has(task.id)) return;
    visited.add(task.id);

    // Visit dependencies first
    for (const depId of (task.dependencies || [])) {
      const dep = tasks.find(t => t.id === depId);
      if (dep) visit(dep);
    }

    task.executionOrder = order.current++;
    result.push(task);

    // Process subtasks
    if (task.subtasks?.length) {
      assignExecutionOrder(task.subtasks, order);
    }
  }

  tasks.forEach(visit);
  return result;
}

// ============================================================================
// DEPENDENCY RESOLUTION
// ============================================================================

/**
 * Analyze and resolve task dependencies
 */
export function resolveDependencies(tasks) {
  const taskMap = new Map();
  const allTasks = flattenTasks(tasks);

  allTasks.forEach(t => taskMap.set(t.id, t));

  // Check for circular dependencies
  const circularDeps = findCircularDependencies(allTasks);
  if (circularDeps.length > 0) {
    return {
      valid: false,
      error: 'Circular dependencies detected',
      circularDependencies: circularDeps
    };
  }

  // Build execution layers (tasks that can run in parallel)
  const layers = [];
  const completed = new Set();

  while (completed.size < allTasks.length) {
    const layer = allTasks.filter(task => {
      if (completed.has(task.id)) return false;
      const deps = task.dependencies || [];
      return deps.every(d => completed.has(d));
    });

    if (layer.length === 0) {
      return {
        valid: false,
        error: 'Unresolvable dependencies',
        remaining: allTasks.filter(t => !completed.has(t.id)).map(t => t.id)
      };
    }

    layers.push(layer.map(t => t.id));
    layer.forEach(t => completed.add(t.id));
  }

  return {
    valid: true,
    executionLayers: layers,
    totalLayers: layers.length,
    maxParallelism: Math.max(...layers.map(l => l.length))
  };
}

/**
 * Flatten nested tasks
 */
function flattenTasks(tasks, result = []) {
  for (const task of tasks) {
    result.push(task);
    if (task.subtasks?.length) {
      flattenTasks(task.subtasks, result);
    }
  }
  return result;
}

/**
 * Find circular dependencies
 */
function findCircularDependencies(tasks) {
  const circular = [];
  const visited = new Set();
  const recursionStack = new Set();

  function dfs(taskId, path) {
    if (recursionStack.has(taskId)) {
      circular.push([...path, taskId]);
      return;
    }
    if (visited.has(taskId)) return;

    visited.add(taskId);
    recursionStack.add(taskId);

    const task = tasks.find(t => t.id === taskId);
    if (task?.dependencies) {
      for (const dep of task.dependencies) {
        dfs(dep, [...path, taskId]);
      }
    }

    recursionStack.delete(taskId);
  }

  tasks.forEach(t => dfs(t.id, []));
  return circular;
}

// ============================================================================
// RESOURCE ALLOCATION
// ============================================================================

/**
 * Allocate resources to tasks
 */
export function allocateResources(tasks, availableResources) {
  const allTasks = flattenTasks(tasks);
  const allocation = {};
  const resourceUsage = {};

  // Initialize resource tracking
  Object.keys(availableResources).forEach(r => {
    resourceUsage[r] = { total: availableResources[r], allocated: 0 };
  });

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const sortedTasks = allTasks.sort((a, b) =>
    (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1)
  );

  for (const task of sortedTasks) {
    allocation[task.id] = { resources: {}, satisfied: true };

    for (const resource of (task.requiredResources || [])) {
      if (resourceUsage[resource] && resourceUsage[resource].allocated < resourceUsage[resource].total) {
        allocation[task.id].resources[resource] = 1;
        resourceUsage[resource].allocated++;
      } else {
        allocation[task.id].satisfied = false;
      }
    }
  }

  return {
    allocation,
    resourceUsage,
    unsatisfiedTasks: Object.entries(allocation)
      .filter(([_, a]) => !a.satisfied)
      .map(([id]) => id)
  };
}

// ============================================================================
// EXECUTION PLANNING
// ============================================================================

/**
 * Create optimized execution plan
 */
export async function createExecutionPlan(goal, options = {}) {
  const { resources = {}, constraints = {} } = options;

  // Decompose goal
  const decomposed = await decomposeGoal(goal, options);
  if (decomposed.error) return decomposed;

  // Resolve dependencies
  const dependencies = resolveDependencies(decomposed.tasks);
  if (!dependencies.valid) return { ...decomposed, dependencies };

  // Allocate resources
  const resourceAllocation = Object.keys(resources).length > 0
    ? allocateResources(decomposed.tasks, resources)
    : { allocation: {}, note: 'No resources specified' };

  // Calculate timeline
  const timeline = calculateTimeline(decomposed.tasks, dependencies.executionLayers);

  // Generate execution schedule
  const schedule = generateSchedule(decomposed.tasks, dependencies.executionLayers, timeline);

  return {
    goal,
    tasks: decomposed.tasks,
    dependencies,
    resourceAllocation,
    timeline,
    schedule,
    metadata: {
      createdAt: new Date().toISOString(),
      estimatedDuration: timeline.totalMinutes
    }
  };
}

/**
 * Calculate timeline for execution
 */
function calculateTimeline(tasks, layers) {
  const allTasks = flattenTasks(tasks);
  const taskMap = new Map(allTasks.map(t => [t.id, t]));

  let totalMinutes = 0;
  const layerTimes = [];

  for (const layer of layers) {
    // Parallel tasks - take max time
    const layerDuration = Math.max(
      ...layer.map(id => taskMap.get(id)?.estimatedMinutes || 15)
    );
    layerTimes.push({ layer, duration: layerDuration });
    totalMinutes += layerDuration;
  }

  return {
    totalMinutes,
    totalHours: (totalMinutes / 60).toFixed(1),
    layerBreakdown: layerTimes
  };
}

/**
 * Generate execution schedule
 */
function generateSchedule(tasks, layers, timeline) {
  const allTasks = flattenTasks(tasks);
  const taskMap = new Map(allTasks.map(t => [t.id, t]));

  const schedule = [];
  let currentTime = 0;

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const layerDuration = timeline.layerBreakdown[i].duration;

    schedule.push({
      phase: i + 1,
      startMinute: currentTime,
      endMinute: currentTime + layerDuration,
      parallelTasks: layer.map(id => ({
        id,
        name: taskMap.get(id)?.name,
        duration: taskMap.get(id)?.estimatedMinutes
      }))
    });

    currentTime += layerDuration;
  }

  return schedule;
}

// ============================================================================
// PROGRESS TRACKING
// ============================================================================

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS execution_plans (
        id SERIAL PRIMARY KEY,
        plan_id VARCHAR(100) UNIQUE,
        goal TEXT,
        plan JSONB,
        status VARCHAR(20) DEFAULT 'pending',
        progress JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await db.query(`CREATE INDEX IF NOT EXISTS idx_plans_status ON execution_plans(status)`);
    schemaReady = true;
  } catch (e) {
    console.error('[Planner] Schema error:', e.message);
  }
}

/**
 * Save execution plan
 */
export async function savePlan(plan) {
  await ensureSchema();

  const planId = `plan_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  await db.query(`
    INSERT INTO execution_plans (plan_id, goal, plan, status)
    VALUES ($1, $2, $3, 'pending')
  `, [planId, plan.goal, JSON.stringify(plan)]);

  return { planId, saved: true };
}

/**
 * Update task progress
 */
export async function updateProgress(planId, taskId, status, notes = null) {
  await ensureSchema();

  const result = await db.query(`
    SELECT progress FROM execution_plans WHERE plan_id = $1
  `, [planId]);

  if (result.rows.length === 0) {
    return { error: 'Plan not found' };
  }

  const progress = result.rows[0].progress || {};
  progress[taskId] = {
    status,
    notes,
    updatedAt: new Date().toISOString()
  };

  // Calculate overall progress
  const taskCount = Object.keys(progress).length;
  const completedCount = Object.values(progress).filter(p => p.status === 'completed').length;
  const overallProgress = taskCount > 0 ? (completedCount / taskCount * 100).toFixed(1) : 0;

  const planStatus = completedCount === taskCount ? 'completed' : 'in_progress';

  await db.query(`
    UPDATE execution_plans
    SET progress = $1, status = $2, updated_at = NOW()
    WHERE plan_id = $3
  `, [JSON.stringify(progress), planStatus, planId]);

  return {
    planId,
    taskId,
    status,
    overallProgress: `${overallProgress}%`,
    planStatus
  };
}

/**
 * Get plan status
 */
export async function getPlanStatus(planId) {
  await ensureSchema();

  const result = await db.query(`
    SELECT * FROM execution_plans WHERE plan_id = $1
  `, [planId]);

  if (result.rows.length === 0) {
    return { error: 'Plan not found' };
  }

  const row = result.rows[0];
  const progress = row.progress || {};
  const taskStatuses = Object.values(progress);

  return {
    planId: row.plan_id,
    goal: row.goal,
    status: row.status,
    progress: {
      completed: taskStatuses.filter(p => p.status === 'completed').length,
      inProgress: taskStatuses.filter(p => p.status === 'in_progress').length,
      pending: taskStatuses.filter(p => p.status === 'pending').length,
      failed: taskStatuses.filter(p => p.status === 'failed').length
    },
    taskDetails: progress,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * List active plans
 */
export async function listActivePlans() {
  await ensureSchema();

  const result = await db.query(`
    SELECT plan_id, goal, status, created_at, updated_at
    FROM execution_plans
    WHERE status IN ('pending', 'in_progress')
    ORDER BY created_at DESC
    LIMIT 20
  `);

  return result.rows;
}

export default {
  // Decomposition
  decomposeGoal,

  // Dependencies
  resolveDependencies,

  // Resources
  allocateResources,

  // Planning
  createExecutionPlan,

  // Progress tracking
  savePlan,
  updateProgress,
  getPlanStatus,
  listActivePlans
};
