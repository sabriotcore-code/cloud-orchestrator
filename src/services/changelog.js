import * as db from '../db/index.js';
import * as memory from './memory.js';

// ============================================================================
// CHANGE LOG SERVICE
// Tracks all code changes made by the bot for history and rollback
// ============================================================================

// Store a change record
export async function logChange(data) {
  const { repo, path, action, oldContent, newContent, message, userId, commitSha } = data;

  const record = {
    id: `change_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    repo,
    path,
    action, // 'create', 'update', 'delete'
    oldContent: oldContent || null,
    newContent: newContent || null,
    message,
    userId: userId || 'bot',
    commitSha: commitSha || null,
  };

  // Store in memory service
  await memory.store(`changelog_${record.id}`, JSON.stringify(record), 'changelog');

  // Also store the ID in a list for easy retrieval
  const listKey = `changelog_list_${repo.replace('/', '_')}`;
  const existingList = await memory.retrieve(listKey);
  const ids = existingList.value ? JSON.parse(existingList.value) : [];
  ids.unshift(record.id); // Add to front

  // Keep last 100 changes per repo
  if (ids.length > 100) ids.pop();
  await memory.store(listKey, JSON.stringify(ids), 'changelog');

  console.log(`[ChangeLog] Recorded: ${action} ${repo}/${path}`);
  return record;
}

// Get recent changes for a repo
export async function getRecentChanges(repo, limit = 10) {
  const listKey = `changelog_list_${repo.replace('/', '_')}`;
  const existingList = await memory.retrieve(listKey);

  if (!existingList.value) return [];

  const ids = JSON.parse(existingList.value).slice(0, limit);
  const changes = [];

  for (const id of ids) {
    const record = await memory.retrieve(`changelog_${id}`);
    if (record.value) {
      changes.push(JSON.parse(record.value));
    }
  }

  return changes;
}

// Get a specific change by ID
export async function getChange(changeId) {
  const record = await memory.retrieve(`changelog_${changeId}`);
  return record.value ? JSON.parse(record.value) : null;
}

// Format changes for display
export function formatChanges(changes) {
  if (!changes.length) return 'No recent changes found.';

  return changes.map(c => {
    const time = new Date(c.timestamp).toLocaleString();
    return `• \`${c.action}\` **${c.path}** - ${c.message}\n  _${time} by ${c.userId}_`;
  }).join('\n\n');
}

// ============================================================================
// ROLLBACK SUPPORT
// ============================================================================

// Get rollback info for a file
export async function getRollbackInfo(repo, path) {
  const changes = await getRecentChanges(repo, 50);
  return changes.filter(c => c.path === path && c.oldContent);
}

// Format for Slack rollback options
export function formatRollbackOptions(changes) {
  return changes.slice(0, 5).map((c, i) => {
    const time = new Date(c.timestamp).toLocaleString();
    return `${i + 1}. ${c.message} (${time})`;
  }).join('\n');
}
