import * as github from './github.js';

// ============================================================================
// MASTER CONTEXT SERVICE
// Loads and manages the master context file for AI reference
// ============================================================================

let masterContext = null;
let lastLoaded = null;
const CONTEXT_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Load master context from GitHub
export async function loadContext() {
  try {
    const file = await github.readFile(
      'sabriotcore-code',
      'cloud-orchestrator',
      'MASTER_CONTEXT.md'
    );

    masterContext = file.content;
    lastLoaded = Date.now();
    console.log('[Context] Master context loaded successfully');
    return masterContext;
  } catch (error) {
    console.error('[Context] Failed to load master context:', error.message);
    return getDefaultContext();
  }
}

// Get context (refresh if stale)
export async function getContext() {
  const now = Date.now();

  // Refresh if never loaded or stale
  if (!masterContext || !lastLoaded || (now - lastLoaded) > CONTEXT_REFRESH_INTERVAL) {
    await loadContext();
  }

  return masterContext || getDefaultContext();
}

// Get a summary of the context for AI prompts
export async function getContextSummary() {
  const context = await getContext();

  // Extract key sections
  const lines = context.split('\n');
  const summary = [];

  let inSection = false;
  let currentSection = '';

  for (const line of lines) {
    if (line.startsWith('## ')) {
      currentSection = line.replace('## ', '');
      inSection = ['OWNER', 'CURRENT PROJECTS', 'CURRENT WORK', 'BUSINESS CONTEXT'].includes(currentSection);
    }

    if (inSection && line.trim()) {
      summary.push(line);
    }
  }

  return summary.join('\n').substring(0, 2000); // Limit to 2000 chars
}

// Update the master context file
export async function updateContext(section, content) {
  try {
    // Read current file
    const file = await github.readFile(
      'sabriotcore-code',
      'cloud-orchestrator',
      'MASTER_CONTEXT.md'
    );

    let updatedContent = file.content;

    // Update the specified section or append
    if (section === 'CURRENT WORK') {
      // Append to current work section
      const timestamp = new Date().toISOString().split('T')[0];
      const newEntry = `- ${timestamp}: ${content}`;

      const workSection = updatedContent.indexOf('### Session:');
      if (workSection > -1) {
        const nextSection = updatedContent.indexOf('###', workSection + 10);
        const insertPoint = nextSection > -1 ? nextSection : updatedContent.indexOf('### Pending Tasks');
        updatedContent = updatedContent.slice(0, insertPoint) + newEntry + '\n' + updatedContent.slice(insertPoint);
      }
    } else if (section === 'PENDING TASKS') {
      // Add to pending tasks
      const pendingSection = updatedContent.indexOf('### Pending Tasks');
      if (pendingSection > -1) {
        const insertPoint = updatedContent.indexOf('\n', pendingSection) + 1;
        updatedContent = updatedContent.slice(0, insertPoint) + `- ${content}\n` + updatedContent.slice(insertPoint);
      }
    } else {
      // Append to update log
      const logSection = updatedContent.indexOf('## UPDATE LOG');
      if (logSection > -1) {
        const tableStart = updatedContent.indexOf('|---', logSection);
        if (tableStart > -1) {
          const insertPoint = updatedContent.indexOf('\n', tableStart) + 1;
          const timestamp = new Date().toISOString().split('T')[0];
          const newRow = `| ${timestamp} | ${content} | AI |\n`;
          updatedContent = updatedContent.slice(0, insertPoint) + newRow + updatedContent.slice(insertPoint);
        }
      }
    }

    // Update last updated date
    updatedContent = updatedContent.replace(
      /# Last Updated: .*/,
      `# Last Updated: ${new Date().toISOString().split('T')[0]}`
    );

    // Commit the update
    await github.createOrUpdateFile(
      'sabriotcore-code',
      'cloud-orchestrator',
      'MASTER_CONTEXT.md',
      updatedContent,
      `Update master context: ${section}`,
      file.sha
    );

    // Refresh local cache
    masterContext = updatedContent;
    lastLoaded = Date.now();

    return { success: true, message: 'Context updated' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Default context if file not available
function getDefaultContext() {
  return `
# MASTER CONTEXT

## OWNER
- Name: Matt
- Business: REI Realty

## CURRENT PROJECTS
- cloud-orchestrator: Multi-AI system on Railway
- rei-dashboard: Real estate dashboard on Netlify
- rei-automation: Automation scripts

## CURRENT WORK
- Building AI orchestration system
- Slack bot integration
- GitHub and Google integrations
`;
}

// Check if context is loaded
export function isLoaded() {
  return masterContext !== null;
}

// Get last load time
export function getLastLoaded() {
  return lastLoaded;
}
