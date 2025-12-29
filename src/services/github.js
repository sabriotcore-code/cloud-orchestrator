import dotenv from 'dotenv';
dotenv.config();

// ============================================================================
// GITHUB API SERVICE
// ============================================================================

const GITHUB_API = 'https://api.github.com';

function getHeaders() {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN not configured');
  }
  return {
    'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Cloud-Orchestrator/1.0',
  };
}

// ============================================================================
// REPOSITORY OPERATIONS
// ============================================================================

// List all repos for the authenticated user
export async function listRepos(perPage = 30) {
  const response = await fetch(`${GITHUB_API}/user/repos?per_page=${perPage}&sort=updated`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const repos = await response.json();
  return repos.map(r => ({
    name: r.full_name,
    description: r.description,
    url: r.html_url,
    language: r.language,
    updatedAt: r.updated_at,
    isPrivate: r.private,
  }));
}

// Get repo details
export async function getRepo(owner, repo) {
  const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  return response.json();
}

// List files in a repo directory
export async function listFiles(owner, repo, path = '') {
  const url = path
    ? `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`
    : `${GITHUB_API}/repos/${owner}/${repo}/contents`;

  const response = await fetch(url, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const contents = await response.json();
  return Array.isArray(contents)
    ? contents.map(f => ({ name: f.name, type: f.type, path: f.path }))
    : [{ name: contents.name, type: contents.type, path: contents.path }];
}

// Read a file from repo
export async function readFile(owner, repo, path) {
  const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const data = await response.json();

  if (data.type !== 'file') {
    throw new Error('Path is not a file');
  }

  // Decode base64 content
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return {
    content,
    sha: data.sha,
    size: data.size,
    path: data.path,
  };
}

// ============================================================================
// COMMIT OPERATIONS
// ============================================================================

// Get recent commits
export async function getCommits(owner, repo, perPage = 10) {
  const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/commits?per_page=${perPage}`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const commits = await response.json();
  return commits.map(c => ({
    sha: c.sha.substring(0, 7),
    message: c.commit.message.split('\n')[0],
    author: c.commit.author.name,
    date: c.commit.author.date,
  }));
}

// Create or update a file (commit)
export async function createOrUpdateFile(owner, repo, path, content, message, sha = null) {
  const body = {
    message,
    content: Buffer.from(content).toString('base64'),
  };

  if (sha) {
    body.sha = sha; // Required for updates
  }

  const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`GitHub API error: ${error.message}`);
  }

  return response.json();
}

// ============================================================================
// ISSUES & PRs
// ============================================================================

// List issues
export async function listIssues(owner, repo, state = 'open', perPage = 10) {
  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/issues?state=${state}&per_page=${perPage}`,
    { headers: getHeaders() }
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const issues = await response.json();
  return issues.map(i => ({
    number: i.number,
    title: i.title,
    state: i.state,
    author: i.user.login,
    createdAt: i.created_at,
    labels: i.labels.map(l => l.name),
  }));
}

// Create an issue
export async function createIssue(owner, repo, title, body, labels = []) {
  const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ title, body, labels }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`GitHub API error: ${error.message}`);
  }

  const issue = await response.json();
  return {
    number: issue.number,
    url: issue.html_url,
    title: issue.title,
  };
}

// List pull requests
export async function listPullRequests(owner, repo, state = 'open', perPage = 10) {
  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls?state=${state}&per_page=${perPage}`,
    { headers: getHeaders() }
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const prs = await response.json();
  return prs.map(p => ({
    number: p.number,
    title: p.title,
    state: p.state,
    author: p.user.login,
    createdAt: p.created_at,
    head: p.head.ref,
    base: p.base.ref,
  }));
}

// ============================================================================
// BRANCHES
// ============================================================================

// List branches
export async function listBranches(owner, repo) {
  const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/branches`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const branches = await response.json();
  return branches.map(b => ({
    name: b.name,
    sha: b.commit.sha.substring(0, 7),
    protected: b.protected,
  }));
}

// ============================================================================
// SEARCH
// ============================================================================

// Search code across repos
export async function searchCode(query, perPage = 10) {
  const response = await fetch(
    `${GITHUB_API}/search/code?q=${encodeURIComponent(query)}&per_page=${perPage}`,
    { headers: getHeaders() }
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const data = await response.json();
  return data.items.map(i => ({
    name: i.name,
    path: i.path,
    repo: i.repository.full_name,
    url: i.html_url,
  }));
}

// ============================================================================
// STATUS CHECK
// ============================================================================

export function isConfigured() {
  return !!process.env.GITHUB_TOKEN;
}

export async function getAuthenticatedUser() {
  if (!process.env.GITHUB_TOKEN) {
    return null;
  }

  try {
    const response = await fetch(`${GITHUB_API}/user`, {
      headers: getHeaders(),
    });

    if (!response.ok) {
      return null;
    }

    const user = await response.json();
    return {
      login: user.login,
      name: user.name,
      repos: user.public_repos + (user.total_private_repos || 0),
    };
  } catch {
    return null;
  }
}
