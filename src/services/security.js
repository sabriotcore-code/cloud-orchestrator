// ============================================================================
// SECURITY & COMPLIANCE SERVICE
// Vulnerability scanning, code quality, and secrets management
// ============================================================================

import fetch from 'node-fetch';

// ============================================================================
// CONFIGURATION
// ============================================================================

const SNYK_TOKEN = process.env.SNYK_TOKEN;
const SNYK_ORG_ID = process.env.SNYK_ORG_ID;
const SONARQUBE_TOKEN = process.env.SONARQUBE_TOKEN;
const SONARQUBE_URL = process.env.SONARQUBE_URL || 'https://sonarcloud.io';
const SONARQUBE_ORG = process.env.SONARQUBE_ORG;
const DEPENDABOT_TOKEN = process.env.GITHUB_TOKEN; // Uses GitHub token
const VAULT_ADDR = process.env.VAULT_ADDR;
const VAULT_TOKEN = process.env.VAULT_TOKEN;

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    snyk: !!SNYK_TOKEN,
    sonarqube: !!SONARQUBE_TOKEN,
    vault: !!VAULT_TOKEN && !!VAULT_ADDR,
    dependabot: !!DEPENDABOT_TOKEN
  };
}

// ============================================================================
// SNYK - Vulnerability Scanning
// ============================================================================

/**
 * List Snyk projects
 */
export async function snykListProjects() {
  if (!SNYK_TOKEN || !SNYK_ORG_ID) throw new Error('Snyk not configured');

  const response = await fetch(
    `https://api.snyk.io/v1/org/${SNYK_ORG_ID}/projects`,
    {
      headers: { 'Authorization': `token ${SNYK_TOKEN}` }
    }
  );

  const data = await response.json();
  return data.projects?.map(p => ({
    id: p.id,
    name: p.name,
    origin: p.origin,
    type: p.type,
    issueCount: {
      critical: p.issueCountsBySeverity?.critical || 0,
      high: p.issueCountsBySeverity?.high || 0,
      medium: p.issueCountsBySeverity?.medium || 0,
      low: p.issueCountsBySeverity?.low || 0
    },
    lastTestedDate: p.lastTestedDate
  })) || [];
}

/**
 * Get issues for a Snyk project
 */
export async function snykGetIssues(projectId, severity = null) {
  if (!SNYK_TOKEN || !SNYK_ORG_ID) throw new Error('Snyk not configured');

  const body = {
    filters: {
      ...(severity && { severity: [severity] }),
      exploitMaturity: ['mature', 'proof-of-concept']
    }
  };

  const response = await fetch(
    `https://api.snyk.io/v1/org/${SNYK_ORG_ID}/project/${projectId}/aggregated-issues`,
    {
      method: 'POST',
      headers: {
        'Authorization': `token ${SNYK_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();
  return data.issues?.map(i => ({
    id: i.id,
    title: i.issueData?.title,
    severity: i.issueData?.severity,
    exploitMaturity: i.issueData?.exploitMaturity,
    description: i.issueData?.description,
    packageName: i.pkgName,
    version: i.pkgVersion,
    fixedIn: i.fixInfo?.nearestFixedInVersion,
    isUpgradable: i.fixInfo?.isUpgradable
  })) || [];
}

/**
 * Test a package for vulnerabilities
 */
export async function snykTestPackage(packageManager, packageName, version) {
  if (!SNYK_TOKEN) throw new Error('Snyk not configured');

  const response = await fetch(
    `https://api.snyk.io/v1/test/${packageManager}/${packageName}/${version}`,
    {
      headers: { 'Authorization': `token ${SNYK_TOKEN}` }
    }
  );

  const data = await response.json();
  return {
    ok: data.ok,
    issuesCount: data.issues?.vulnerabilities?.length || 0,
    issues: data.issues?.vulnerabilities?.slice(0, 5) || []
  };
}

/**
 * Get Snyk organization summary
 */
export async function snykGetSummary() {
  if (!SNYK_TOKEN || !SNYK_ORG_ID) throw new Error('Snyk not configured');

  const projects = await snykListProjects();

  const summary = {
    projectCount: projects.length,
    totalIssues: { critical: 0, high: 0, medium: 0, low: 0 },
    criticalProjects: []
  };

  for (const project of projects) {
    summary.totalIssues.critical += project.issueCount.critical;
    summary.totalIssues.high += project.issueCount.high;
    summary.totalIssues.medium += project.issueCount.medium;
    summary.totalIssues.low += project.issueCount.low;

    if (project.issueCount.critical > 0) {
      summary.criticalProjects.push({
        name: project.name,
        critical: project.issueCount.critical
      });
    }
  }

  return summary;
}

// ============================================================================
// SONARQUBE / SONARCLOUD - Code Quality
// ============================================================================

/**
 * Get SonarQube project analysis
 */
export async function sonarGetProject(projectKey) {
  if (!SONARQUBE_TOKEN) throw new Error('SonarQube not configured');

  const response = await fetch(
    `${SONARQUBE_URL}/api/measures/component?component=${projectKey}&metricKeys=bugs,vulnerabilities,code_smells,coverage,duplicated_lines_density,security_hotspots`,
    {
      headers: { 'Authorization': `Bearer ${SONARQUBE_TOKEN}` }
    }
  );

  const data = await response.json();
  const measures = {};

  for (const measure of data.component?.measures || []) {
    measures[measure.metric] = parseFloat(measure.value) || measure.value;
  }

  return {
    key: projectKey,
    bugs: measures.bugs || 0,
    vulnerabilities: measures.vulnerabilities || 0,
    codeSmells: measures.code_smells || 0,
    coverage: measures.coverage || 0,
    duplication: measures.duplicated_lines_density || 0,
    securityHotspots: measures.security_hotspots || 0
  };
}

/**
 * Get SonarQube issues
 */
export async function sonarGetIssues(projectKey, types = 'BUG,VULNERABILITY,CODE_SMELL', limit = 20) {
  if (!SONARQUBE_TOKEN) throw new Error('SonarQube not configured');

  const params = new URLSearchParams({
    componentKeys: projectKey,
    types,
    ps: limit.toString(),
    s: 'SEVERITY',
    asc: 'false'
  });

  const response = await fetch(
    `${SONARQUBE_URL}/api/issues/search?${params}`,
    {
      headers: { 'Authorization': `Bearer ${SONARQUBE_TOKEN}` }
    }
  );

  const data = await response.json();
  return data.issues?.map(i => ({
    key: i.key,
    type: i.type,
    severity: i.severity,
    message: i.message,
    component: i.component,
    line: i.line,
    status: i.status,
    effort: i.effort
  })) || [];
}

/**
 * Get SonarQube quality gate status
 */
export async function sonarGetQualityGate(projectKey) {
  if (!SONARQUBE_TOKEN) throw new Error('SonarQube not configured');

  const response = await fetch(
    `${SONARQUBE_URL}/api/qualitygates/project_status?projectKey=${projectKey}`,
    {
      headers: { 'Authorization': `Bearer ${SONARQUBE_TOKEN}` }
    }
  );

  const data = await response.json();
  return {
    status: data.projectStatus?.status,
    conditions: data.projectStatus?.conditions?.map(c => ({
      metric: c.metricKey,
      status: c.status,
      actualValue: c.actualValue,
      threshold: c.errorThreshold
    })) || []
  };
}

// ============================================================================
// DEPENDABOT - GitHub Vulnerability Alerts
// ============================================================================

/**
 * Get Dependabot alerts for a repository
 */
export async function getDependabotAlerts(owner, repo, state = 'open') {
  if (!DEPENDABOT_TOKEN) throw new Error('GitHub token not configured');

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/dependabot/alerts?state=${state}&per_page=50`,
    {
      headers: {
        'Authorization': `Bearer ${DEPENDABOT_TOKEN}`,
        'Accept': 'application/vnd.github+json'
      }
    }
  );

  const data = await response.json();
  return data.map?.(a => ({
    number: a.number,
    state: a.state,
    severity: a.security_advisory?.severity,
    summary: a.security_advisory?.summary,
    package: a.dependency?.package?.name,
    manifestPath: a.dependency?.manifest_path,
    vulnerableVersionRange: a.security_vulnerability?.vulnerable_version_range,
    firstPatchedVersion: a.security_vulnerability?.first_patched_version?.identifier,
    createdAt: a.created_at
  })) || [];
}

/**
 * Dismiss a Dependabot alert
 */
export async function dismissDependabotAlert(owner, repo, alertNumber, reason = 'not_used') {
  if (!DEPENDABOT_TOKEN) throw new Error('GitHub token not configured');

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/dependabot/alerts/${alertNumber}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${DEPENDABOT_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        state: 'dismissed',
        dismissed_reason: reason,
        dismissed_comment: 'Dismissed via Slack bot'
      })
    }
  );

  return { dismissed: response.ok, alertNumber };
}

/**
 * Get code scanning alerts
 */
export async function getCodeScanningAlerts(owner, repo, state = 'open') {
  if (!DEPENDABOT_TOKEN) throw new Error('GitHub token not configured');

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/code-scanning/alerts?state=${state}&per_page=50`,
    {
      headers: {
        'Authorization': `Bearer ${DEPENDABOT_TOKEN}`,
        'Accept': 'application/vnd.github+json'
      }
    }
  );

  const data = await response.json();
  return data.map?.(a => ({
    number: a.number,
    state: a.state,
    severity: a.rule?.security_severity_level || a.rule?.severity,
    description: a.rule?.description,
    tool: a.tool?.name,
    file: a.most_recent_instance?.location?.path,
    line: a.most_recent_instance?.location?.start_line,
    createdAt: a.created_at
  })) || [];
}

// ============================================================================
// HASHICORP VAULT - Secrets Management
// ============================================================================

/**
 * Get a secret from Vault
 */
export async function vaultGetSecret(path) {
  if (!VAULT_TOKEN || !VAULT_ADDR) throw new Error('Vault not configured');

  const response = await fetch(
    `${VAULT_ADDR}/v1/${path}`,
    {
      headers: { 'X-Vault-Token': VAULT_TOKEN }
    }
  );

  const data = await response.json();
  return data.data?.data || data.data || null;
}

/**
 * Store a secret in Vault
 */
export async function vaultPutSecret(path, secret) {
  if (!VAULT_TOKEN || !VAULT_ADDR) throw new Error('Vault not configured');

  const response = await fetch(
    `${VAULT_ADDR}/v1/${path}`,
    {
      method: 'POST',
      headers: {
        'X-Vault-Token': VAULT_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data: secret })
    }
  );

  return { stored: response.ok, path };
}

/**
 * List secrets at a path
 */
export async function vaultListSecrets(path) {
  if (!VAULT_TOKEN || !VAULT_ADDR) throw new Error('Vault not configured');

  const response = await fetch(
    `${VAULT_ADDR}/v1/${path}?list=true`,
    {
      headers: { 'X-Vault-Token': VAULT_TOKEN }
    }
  );

  const data = await response.json();
  return data.data?.keys || [];
}

/**
 * Delete a secret from Vault
 */
export async function vaultDeleteSecret(path) {
  if (!VAULT_TOKEN || !VAULT_ADDR) throw new Error('Vault not configured');

  const response = await fetch(
    `${VAULT_ADDR}/v1/${path}`,
    {
      method: 'DELETE',
      headers: { 'X-Vault-Token': VAULT_TOKEN }
    }
  );

  return { deleted: response.ok, path };
}

// ============================================================================
// SECURITY SCANNING HELPERS
// ============================================================================

/**
 * Scan code for hardcoded secrets (basic patterns)
 */
export function scanForSecrets(code) {
  const patterns = [
    { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/g },
    { name: 'AWS Secret Key', pattern: /[A-Za-z0-9\/+=]{40}/g },
    { name: 'GitHub Token', pattern: /ghp_[A-Za-z0-9]{36}/g },
    { name: 'GitHub OAuth', pattern: /gho_[A-Za-z0-9]{36}/g },
    { name: 'Slack Token', pattern: /xox[baprs]-[A-Za-z0-9-]+/g },
    { name: 'Private Key', pattern: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/g },
    { name: 'Generic API Key', pattern: /api[_-]?key["\s:=]+["\']?[A-Za-z0-9_-]{20,}["\']?/gi },
    { name: 'Generic Secret', pattern: /secret["\s:=]+["\']?[A-Za-z0-9_-]{20,}["\']?/gi },
    { name: 'Password', pattern: /password["\s:=]+["\']?[^\s"\']{8,}["\']?/gi },
    { name: 'Bearer Token', pattern: /Bearer\s+[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
    { name: 'JWT', pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g }
  ];

  const findings = [];

  for (const { name, pattern } of patterns) {
    const matches = code.match(pattern);
    if (matches) {
      findings.push({
        type: name,
        count: matches.length,
        samples: matches.slice(0, 2).map(m => m.substring(0, 20) + '...')
      });
    }
  }

  return {
    hasSecrets: findings.length > 0,
    findings
  };
}

/**
 * Check for common security anti-patterns in code
 */
export function scanForAntiPatterns(code, language = 'javascript') {
  const patterns = {
    javascript: [
      { name: 'eval() usage', pattern: /\beval\s*\(/g, severity: 'high' },
      { name: 'innerHTML assignment', pattern: /\.innerHTML\s*=/g, severity: 'medium' },
      { name: 'document.write', pattern: /document\.write\s*\(/g, severity: 'medium' },
      { name: 'SQL concatenation', pattern: /["'`]SELECT.*\+.*["'`]/gi, severity: 'high' },
      { name: 'Hardcoded credentials', pattern: /(password|secret|key)\s*[:=]\s*["'][^"']+["']/gi, severity: 'critical' },
      { name: 'HTTP (not HTTPS)', pattern: /http:\/\/[^"'\s]+/g, severity: 'low' },
      { name: 'console.log with sensitive', pattern: /console\.log.*\b(password|token|key|secret)\b/gi, severity: 'medium' }
    ],
    python: [
      { name: 'exec() usage', pattern: /\bexec\s*\(/g, severity: 'high' },
      { name: 'pickle.loads', pattern: /pickle\.loads?\s*\(/g, severity: 'high' },
      { name: 'SQL concatenation', pattern: /["']SELECT.*%s.*["']/gi, severity: 'high' },
      { name: 'Shell injection', pattern: /subprocess\.(call|run|Popen).*shell\s*=\s*True/g, severity: 'critical' }
    ]
  };

  const languagePatterns = patterns[language] || patterns.javascript;
  const findings = [];

  for (const { name, pattern, severity } of languagePatterns) {
    const matches = code.match(pattern);
    if (matches) {
      findings.push({
        name,
        severity,
        count: matches.length
      });
    }
  }

  return {
    score: calculateSecurityScore(findings),
    findings
  };
}

function calculateSecurityScore(findings) {
  const weights = { critical: 30, high: 15, medium: 5, low: 1 };
  let penalty = 0;

  for (const finding of findings) {
    penalty += (weights[finding.severity] || 5) * finding.count;
  }

  return Math.max(0, 100 - penalty);
}

/**
 * Get aggregated security report for a repository
 */
export async function getSecurityReport(owner, repo) {
  const report = {
    repo: `${owner}/${repo}`,
    timestamp: new Date().toISOString(),
    dependabot: { alerts: [], error: null },
    codeScanning: { alerts: [], error: null },
    snyk: { issues: [], error: null },
    sonar: { metrics: null, error: null }
  };

  // Dependabot
  try {
    report.dependabot.alerts = await getDependabotAlerts(owner, repo);
  } catch (e) {
    report.dependabot.error = e.message;
  }

  // Code Scanning
  try {
    report.codeScanning.alerts = await getCodeScanningAlerts(owner, repo);
  } catch (e) {
    report.codeScanning.error = e.message;
  }

  // Snyk (if project exists)
  if (SNYK_TOKEN && SNYK_ORG_ID) {
    try {
      const projects = await snykListProjects();
      const project = projects.find(p => p.name.includes(repo));
      if (project) {
        report.snyk.issues = await snykGetIssues(project.id);
      }
    } catch (e) {
      report.snyk.error = e.message;
    }
  }

  // SonarQube (if project exists)
  if (SONARQUBE_TOKEN) {
    try {
      report.sonar.metrics = await sonarGetProject(`${owner}_${repo}`);
    } catch (e) {
      report.sonar.error = e.message;
    }
  }

  // Calculate overall risk score
  const criticalCount =
    (report.dependabot.alerts.filter(a => a.severity === 'critical').length) +
    (report.codeScanning.alerts.filter(a => a.severity === 'critical').length) +
    (report.snyk.issues.filter(i => i.severity === 'critical').length);

  const highCount =
    (report.dependabot.alerts.filter(a => a.severity === 'high').length) +
    (report.codeScanning.alerts.filter(a => a.severity === 'high').length) +
    (report.snyk.issues.filter(i => i.severity === 'high').length);

  report.summary = {
    criticalIssues: criticalCount,
    highIssues: highCount,
    riskLevel: criticalCount > 0 ? 'CRITICAL' : highCount > 5 ? 'HIGH' : highCount > 0 ? 'MEDIUM' : 'LOW'
  };

  return report;
}

export default {
  getStatus,
  // Snyk
  snykListProjects,
  snykGetIssues,
  snykTestPackage,
  snykGetSummary,
  // SonarQube
  sonarGetProject,
  sonarGetIssues,
  sonarGetQualityGate,
  // Dependabot / GitHub
  getDependabotAlerts,
  dismissDependabotAlert,
  getCodeScanningAlerts,
  // Vault
  vaultGetSecret,
  vaultPutSecret,
  vaultListSecrets,
  vaultDeleteSecret,
  // Local scanning
  scanForSecrets,
  scanForAntiPatterns,
  // Reports
  getSecurityReport
};
