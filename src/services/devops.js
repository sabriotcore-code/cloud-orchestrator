// ============================================================================
// DEVOPS INTEGRATIONS SERVICE
// CI/CD, monitoring, and infrastructure controls
// ============================================================================

import fetch from 'node-fetch';

// ============================================================================
// CONFIGURATION
// ============================================================================

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const NETLIFY_TOKEN = process.env.NETLIFY_TOKEN;
const SENTRY_TOKEN = process.env.SENTRY_TOKEN;
const SENTRY_ORG = process.env.SENTRY_ORG;
const DATADOG_API_KEY = process.env.DATADOG_API_KEY;
const PAGERDUTY_TOKEN = process.env.PAGERDUTY_TOKEN;
const LAUNCHDARKLY_TOKEN = process.env.LAUNCHDARKLY_TOKEN;

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    githubActions: !!GITHUB_TOKEN,
    vercel: !!VERCEL_TOKEN,
    netlify: !!NETLIFY_TOKEN,
    sentry: !!SENTRY_TOKEN,
    datadog: !!DATADOG_API_KEY,
    pagerduty: !!PAGERDUTY_TOKEN,
    launchdarkly: !!LAUNCHDARKLY_TOKEN
  };
}

// ============================================================================
// GITHUB ACTIONS
// ============================================================================

/**
 * List workflow runs for a repository
 */
export async function listWorkflowRuns(owner, repo, options = {}) {
  if (!GITHUB_TOKEN) throw new Error('GitHub token not configured');

  const params = new URLSearchParams({
    per_page: options.limit || 10,
    ...(options.status && { status: options.status }),
    ...(options.branch && { branch: options.branch })
  });

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/runs?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    }
  );

  const data = await response.json();
  return data.workflow_runs?.map(run => ({
    id: run.id,
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    branch: run.head_branch,
    commit: run.head_sha?.substring(0, 7),
    url: run.html_url,
    createdAt: run.created_at,
    updatedAt: run.updated_at
  })) || [];
}

/**
 * Trigger a workflow dispatch event
 */
export async function triggerWorkflow(owner, repo, workflowId, ref = 'main', inputs = {}) {
  if (!GITHUB_TOKEN) throw new Error('GitHub token not configured');

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ref, inputs })
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to trigger workflow');
  }

  return { triggered: true, workflow: workflowId, ref };
}

/**
 * Cancel a workflow run
 */
export async function cancelWorkflowRun(owner, repo, runId) {
  if (!GITHUB_TOKEN) throw new Error('GitHub token not configured');

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/cancel`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    }
  );

  return { cancelled: response.ok, runId };
}

/**
 * Re-run a failed workflow
 */
export async function rerunWorkflow(owner, repo, runId, failedOnly = true) {
  if (!GITHUB_TOKEN) throw new Error('GitHub token not configured');

  const endpoint = failedOnly ? 'rerun-failed-jobs' : 'rerun';
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/${endpoint}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    }
  );

  return { rerun: response.ok, runId, failedOnly };
}

/**
 * Get workflow run logs
 */
export async function getWorkflowLogs(owner, repo, runId) {
  if (!GITHUB_TOKEN) throw new Error('GitHub token not configured');

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/logs`,
    {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      },
      redirect: 'follow'
    }
  );

  if (response.ok) {
    return { logsUrl: response.url };
  }

  return { error: 'Could not fetch logs' };
}

// ============================================================================
// VERCEL
// ============================================================================

/**
 * List Vercel deployments
 */
export async function listVercelDeployments(projectId, limit = 10) {
  if (!VERCEL_TOKEN) throw new Error('Vercel token not configured');

  const params = new URLSearchParams({
    limit: limit.toString(),
    ...(projectId && { projectId })
  });

  const response = await fetch(
    `https://api.vercel.com/v6/deployments?${params}`,
    {
      headers: { 'Authorization': `Bearer ${VERCEL_TOKEN}` }
    }
  );

  const data = await response.json();
  return data.deployments?.map(d => ({
    id: d.uid,
    name: d.name,
    url: d.url,
    state: d.state,
    target: d.target,
    createdAt: d.createdAt,
    ready: d.ready
  })) || [];
}

/**
 * Trigger a Vercel deployment
 */
export async function triggerVercelDeployment(projectId, target = 'production') {
  if (!VERCEL_TOKEN) throw new Error('Vercel token not configured');

  const response = await fetch(
    `https://api.vercel.com/v13/deployments`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: projectId,
        target,
        gitSource: { type: 'github', ref: 'main' }
      })
    }
  );

  const data = await response.json();
  return {
    id: data.id,
    url: data.url,
    state: data.state
  };
}

/**
 * Get Vercel deployment status
 */
export async function getVercelDeploymentStatus(deploymentId) {
  if (!VERCEL_TOKEN) throw new Error('Vercel token not configured');

  const response = await fetch(
    `https://api.vercel.com/v13/deployments/${deploymentId}`,
    {
      headers: { 'Authorization': `Bearer ${VERCEL_TOKEN}` }
    }
  );

  const data = await response.json();
  return {
    id: data.id,
    url: data.url,
    state: data.state,
    readyState: data.readyState,
    createdAt: data.createdAt
  };
}

// ============================================================================
// NETLIFY
// ============================================================================

/**
 * List Netlify sites
 */
export async function listNetlifySites() {
  if (!NETLIFY_TOKEN) throw new Error('Netlify token not configured');

  const response = await fetch(
    'https://api.netlify.com/api/v1/sites',
    {
      headers: { 'Authorization': `Bearer ${NETLIFY_TOKEN}` }
    }
  );

  const data = await response.json();
  return data.map(s => ({
    id: s.id,
    name: s.name,
    url: s.url,
    sslUrl: s.ssl_url,
    state: s.state,
    updatedAt: s.updated_at
  }));
}

/**
 * Trigger a Netlify build
 */
export async function triggerNetlifyBuild(siteId, clearCache = false) {
  if (!NETLIFY_TOKEN) throw new Error('Netlify token not configured');

  const response = await fetch(
    `https://api.netlify.com/api/v1/sites/${siteId}/builds`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NETLIFY_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ clear_cache: clearCache })
    }
  );

  const data = await response.json();
  return {
    id: data.id,
    state: data.state,
    createdAt: data.created_at
  };
}

/**
 * Get Netlify deploy status
 */
export async function getNetlifyDeployStatus(deployId) {
  if (!NETLIFY_TOKEN) throw new Error('Netlify token not configured');

  const response = await fetch(
    `https://api.netlify.com/api/v1/deploys/${deployId}`,
    {
      headers: { 'Authorization': `Bearer ${NETLIFY_TOKEN}` }
    }
  );

  const data = await response.json();
  return {
    id: data.id,
    state: data.state,
    errorMessage: data.error_message,
    deployUrl: data.deploy_url,
    createdAt: data.created_at,
    publishedAt: data.published_at
  };
}

// ============================================================================
// SENTRY (Error Tracking)
// ============================================================================

/**
 * List recent Sentry issues
 */
export async function listSentryIssues(project, options = {}) {
  if (!SENTRY_TOKEN || !SENTRY_ORG) throw new Error('Sentry not configured');

  const params = new URLSearchParams({
    limit: options.limit || 10,
    ...(options.query && { query: options.query })
  });

  const response = await fetch(
    `https://sentry.io/api/0/projects/${SENTRY_ORG}/${project}/issues/?${params}`,
    {
      headers: { 'Authorization': `Bearer ${SENTRY_TOKEN}` }
    }
  );

  const data = await response.json();
  return data.map(issue => ({
    id: issue.id,
    title: issue.title,
    culprit: issue.culprit,
    level: issue.level,
    count: issue.count,
    userCount: issue.userCount,
    firstSeen: issue.firstSeen,
    lastSeen: issue.lastSeen,
    status: issue.status,
    permalink: issue.permalink
  }));
}

/**
 * Get Sentry issue details
 */
export async function getSentryIssue(issueId) {
  if (!SENTRY_TOKEN) throw new Error('Sentry not configured');

  const response = await fetch(
    `https://sentry.io/api/0/issues/${issueId}/`,
    {
      headers: { 'Authorization': `Bearer ${SENTRY_TOKEN}` }
    }
  );

  const data = await response.json();
  return {
    id: data.id,
    title: data.title,
    metadata: data.metadata,
    count: data.count,
    userCount: data.userCount,
    firstSeen: data.firstSeen,
    lastSeen: data.lastSeen,
    status: data.status,
    permalink: data.permalink
  };
}

/**
 * Get latest Sentry events for an issue
 */
export async function getSentryEvents(issueId, limit = 5) {
  if (!SENTRY_TOKEN) throw new Error('Sentry not configured');

  const response = await fetch(
    `https://sentry.io/api/0/issues/${issueId}/events/?limit=${limit}`,
    {
      headers: { 'Authorization': `Bearer ${SENTRY_TOKEN}` }
    }
  );

  const data = await response.json();
  return data.map(event => ({
    id: event.eventID,
    message: event.message,
    timestamp: event.dateCreated,
    tags: event.tags,
    context: event.context
  }));
}

/**
 * Resolve a Sentry issue
 */
export async function resolveSentryIssue(issueId) {
  if (!SENTRY_TOKEN) throw new Error('Sentry not configured');

  const response = await fetch(
    `https://sentry.io/api/0/issues/${issueId}/`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${SENTRY_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'resolved' })
    }
  );

  return { resolved: response.ok, issueId };
}

// ============================================================================
// DATADOG (Monitoring)
// ============================================================================

/**
 * Send a custom metric to Datadog
 */
export async function sendDatadogMetric(metric, value, tags = []) {
  if (!DATADOG_API_KEY) throw new Error('Datadog not configured');

  const response = await fetch(
    'https://api.datadoghq.com/api/v2/series',
    {
      method: 'POST',
      headers: {
        'DD-API-KEY': DATADOG_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        series: [{
          metric,
          type: 0, // gauge
          points: [{ timestamp: Math.floor(Date.now() / 1000), value }],
          tags
        }]
      })
    }
  );

  return { sent: response.ok, metric, value };
}

/**
 * Create a Datadog event
 */
export async function createDatadogEvent(title, text, alertType = 'info', tags = []) {
  if (!DATADOG_API_KEY) throw new Error('Datadog not configured');

  const response = await fetch(
    'https://api.datadoghq.com/api/v1/events',
    {
      method: 'POST',
      headers: {
        'DD-API-KEY': DATADOG_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title,
        text,
        alert_type: alertType,
        tags
      })
    }
  );

  const data = await response.json();
  return { created: response.ok, eventId: data.event?.id };
}

// ============================================================================
// PAGERDUTY (Alerting)
// ============================================================================

/**
 * Create a PagerDuty incident
 */
export async function createPagerDutyIncident(title, details, serviceId, urgency = 'high') {
  if (!PAGERDUTY_TOKEN) throw new Error('PagerDuty not configured');

  const response = await fetch(
    'https://api.pagerduty.com/incidents',
    {
      method: 'POST',
      headers: {
        'Authorization': `Token token=${PAGERDUTY_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        incident: {
          type: 'incident',
          title,
          service: { id: serviceId, type: 'service_reference' },
          urgency,
          body: { type: 'incident_body', details }
        }
      })
    }
  );

  const data = await response.json();
  return {
    created: response.ok,
    incidentId: data.incident?.id,
    incidentNumber: data.incident?.incident_number
  };
}

/**
 * List PagerDuty incidents
 */
export async function listPagerDutyIncidents(status = 'triggered,acknowledged') {
  if (!PAGERDUTY_TOKEN) throw new Error('PagerDuty not configured');

  const response = await fetch(
    `https://api.pagerduty.com/incidents?statuses[]=${status}`,
    {
      headers: {
        'Authorization': `Token token=${PAGERDUTY_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );

  const data = await response.json();
  return data.incidents?.map(i => ({
    id: i.id,
    incidentNumber: i.incident_number,
    title: i.title,
    status: i.status,
    urgency: i.urgency,
    createdAt: i.created_at
  })) || [];
}

// ============================================================================
// LAUNCHDARKLY (Feature Flags)
// ============================================================================

/**
 * Get feature flag status
 */
export async function getFeatureFlag(projectKey, flagKey, environmentKey = 'production') {
  if (!LAUNCHDARKLY_TOKEN) throw new Error('LaunchDarkly not configured');

  const response = await fetch(
    `https://app.launchdarkly.com/api/v2/flags/${projectKey}/${flagKey}`,
    {
      headers: { 'Authorization': LAUNCHDARKLY_TOKEN }
    }
  );

  const data = await response.json();
  const env = data.environments?.[environmentKey];

  return {
    key: data.key,
    name: data.name,
    on: env?.on,
    offVariation: env?.offVariation,
    fallthrough: env?.fallthrough
  };
}

/**
 * Toggle a feature flag
 */
export async function toggleFeatureFlag(projectKey, flagKey, environmentKey, enable) {
  if (!LAUNCHDARKLY_TOKEN) throw new Error('LaunchDarkly not configured');

  const response = await fetch(
    `https://app.launchdarkly.com/api/v2/flags/${projectKey}/${flagKey}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': LAUNCHDARKLY_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        patch: [{
          op: 'replace',
          path: `/environments/${environmentKey}/on`,
          value: enable
        }]
      })
    }
  );

  return { toggled: response.ok, flag: flagKey, enabled: enable };
}

// ============================================================================
// AGGREGATED STATUS
// ============================================================================

/**
 * Get overall deployment status across all platforms
 */
export async function getDeploymentStatus(repos = []) {
  const status = {
    github: [],
    vercel: [],
    netlify: [],
    errors: []
  };

  // GitHub Actions
  if (GITHUB_TOKEN) {
    for (const repo of repos) {
      try {
        const [owner, repoName] = repo.split('/');
        const runs = await listWorkflowRuns(owner, repoName, { limit: 1 });
        status.github.push({
          repo,
          latestRun: runs[0] || null
        });
      } catch (e) {
        status.errors.push({ source: 'github', repo, error: e.message });
      }
    }
  }

  // Vercel
  if (VERCEL_TOKEN) {
    try {
      const deployments = await listVercelDeployments(null, 5);
      status.vercel = deployments;
    } catch (e) {
      status.errors.push({ source: 'vercel', error: e.message });
    }
  }

  // Netlify
  if (NETLIFY_TOKEN) {
    try {
      const sites = await listNetlifySites();
      status.netlify = sites;
    } catch (e) {
      status.errors.push({ source: 'netlify', error: e.message });
    }
  }

  return status;
}

export default {
  getStatus,
  // GitHub Actions
  listWorkflowRuns,
  triggerWorkflow,
  cancelWorkflowRun,
  rerunWorkflow,
  getWorkflowLogs,
  // Vercel
  listVercelDeployments,
  triggerVercelDeployment,
  getVercelDeploymentStatus,
  // Netlify
  listNetlifySites,
  triggerNetlifyBuild,
  getNetlifyDeployStatus,
  // Sentry
  listSentryIssues,
  getSentryIssue,
  getSentryEvents,
  resolveSentryIssue,
  // Datadog
  sendDatadogMetric,
  createDatadogEvent,
  // PagerDuty
  createPagerDutyIncident,
  listPagerDutyIncidents,
  // LaunchDarkly
  getFeatureFlag,
  toggleFeatureFlag,
  // Aggregated
  getDeploymentStatus
};
