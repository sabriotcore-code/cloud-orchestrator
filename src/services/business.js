// ============================================================================
// BUSINESS INTELLIGENCE INTEGRATIONS
// Notion, Linear, Airtable, Jira, and more
// ============================================================================

import fetch from 'node-fetch';

// ============================================================================
// CONFIGURATION
// ============================================================================

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = '2022-06-28';
const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const JIRA_TOKEN = process.env.JIRA_TOKEN;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_DOMAIN = process.env.JIRA_DOMAIN; // e.g., 'yourcompany.atlassian.net'
const MONDAY_TOKEN = process.env.MONDAY_TOKEN;
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    notion: !!NOTION_TOKEN,
    linear: !!LINEAR_API_KEY,
    airtable: !!AIRTABLE_API_KEY,
    jira: !!JIRA_TOKEN && !!JIRA_DOMAIN,
    monday: !!MONDAY_TOKEN,
    hubspot: !!HUBSPOT_TOKEN,
    stripe: !!STRIPE_SECRET_KEY
  };
}

// ============================================================================
// NOTION
// ============================================================================

/**
 * Search Notion pages
 */
export async function notionSearch(query, filter = {}) {
  if (!NOTION_TOKEN) throw new Error('Notion not configured');

  const response = await fetch('https://api.notion.com/v1/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query,
      filter: filter.type ? { property: 'object', value: filter.type } : undefined,
      page_size: filter.limit || 10
    })
  });

  const data = await response.json();
  return data.results?.map(r => ({
    id: r.id,
    type: r.object,
    title: r.properties?.title?.title?.[0]?.plain_text ||
           r.properties?.Name?.title?.[0]?.plain_text ||
           r.title?.[0]?.plain_text ||
           'Untitled',
    url: r.url,
    createdTime: r.created_time,
    lastEditedTime: r.last_edited_time
  })) || [];
}

/**
 * Get a Notion page
 */
export async function notionGetPage(pageId) {
  if (!NOTION_TOKEN) throw new Error('Notion not configured');

  const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION
    }
  });

  return await response.json();
}

/**
 * Create a Notion page
 */
export async function notionCreatePage(parentId, title, content = '', isDatabase = false) {
  if (!NOTION_TOKEN) throw new Error('Notion not configured');

  const body = {
    parent: isDatabase
      ? { database_id: parentId }
      : { page_id: parentId },
    properties: {
      title: {
        title: [{ text: { content: title } }]
      }
    }
  };

  if (content) {
    body.children = [{
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content } }]
      }
    }];
  }

  const response = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  return { id: data.id, url: data.url };
}

/**
 * Query a Notion database
 */
export async function notionQueryDatabase(databaseId, filter = null, sorts = []) {
  if (!NOTION_TOKEN) throw new Error('Notion not configured');

  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ filter, sorts })
  });

  const data = await response.json();
  return data.results || [];
}

// ============================================================================
// LINEAR
// ============================================================================

async function linearQuery(query, variables = {}) {
  if (!LINEAR_API_KEY) throw new Error('Linear not configured');

  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Authorization': LINEAR_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });

  const data = await response.json();
  if (data.errors) {
    throw new Error(data.errors[0].message);
  }
  return data.data;
}

/**
 * List Linear issues
 */
export async function linearListIssues(options = {}) {
  const query = `
    query Issues($first: Int, $filter: IssueFilter) {
      issues(first: $first, filter: $filter) {
        nodes {
          id
          identifier
          title
          description
          state { name }
          priority
          assignee { name email }
          createdAt
          updatedAt
          url
        }
      }
    }
  `;

  const data = await linearQuery(query, {
    first: options.limit || 20,
    filter: options.filter || null
  });

  return data.issues?.nodes || [];
}

/**
 * Create a Linear issue
 */
export async function linearCreateIssue(title, description, teamId, options = {}) {
  const query = `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          identifier
          title
          url
        }
      }
    }
  `;

  const data = await linearQuery(query, {
    input: {
      title,
      description,
      teamId,
      priority: options.priority || 0,
      assigneeId: options.assigneeId,
      labelIds: options.labelIds
    }
  });

  return data.issueCreate?.issue;
}

/**
 * Update a Linear issue
 */
export async function linearUpdateIssue(issueId, updates) {
  const query = `
    mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue {
          id
          identifier
          title
          state { name }
        }
      }
    }
  `;

  const data = await linearQuery(query, {
    id: issueId,
    input: updates
  });

  return data.issueUpdate?.issue;
}

/**
 * Get Linear teams
 */
export async function linearGetTeams() {
  const query = `
    query Teams {
      teams {
        nodes {
          id
          name
          key
        }
      }
    }
  `;

  const data = await linearQuery(query);
  return data.teams?.nodes || [];
}

// ============================================================================
// AIRTABLE
// ============================================================================

/**
 * List Airtable records
 */
export async function airtableListRecords(baseId, tableId, options = {}) {
  if (!AIRTABLE_API_KEY) throw new Error('Airtable not configured');

  const params = new URLSearchParams({
    ...(options.maxRecords && { maxRecords: options.maxRecords }),
    ...(options.view && { view: options.view }),
    ...(options.filterByFormula && { filterByFormula: options.filterByFormula })
  });

  const response = await fetch(
    `https://api.airtable.com/v0/${baseId}/${tableId}?${params}`,
    {
      headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` }
    }
  );

  const data = await response.json();
  return data.records?.map(r => ({
    id: r.id,
    fields: r.fields,
    createdTime: r.createdTime
  })) || [];
}

/**
 * Create an Airtable record
 */
export async function airtableCreateRecord(baseId, tableId, fields) {
  if (!AIRTABLE_API_KEY) throw new Error('Airtable not configured');

  const response = await fetch(
    `https://api.airtable.com/v0/${baseId}/${tableId}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    }
  );

  const data = await response.json();
  return { id: data.id, fields: data.fields };
}

/**
 * Update an Airtable record
 */
export async function airtableUpdateRecord(baseId, tableId, recordId, fields) {
  if (!AIRTABLE_API_KEY) throw new Error('Airtable not configured');

  const response = await fetch(
    `https://api.airtable.com/v0/${baseId}/${tableId}/${recordId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    }
  );

  const data = await response.json();
  return { id: data.id, fields: data.fields };
}

// ============================================================================
// JIRA
// ============================================================================

/**
 * Search Jira issues with JQL
 */
export async function jiraSearchIssues(jql, maxResults = 20) {
  if (!JIRA_TOKEN || !JIRA_DOMAIN) throw new Error('Jira not configured');

  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

  const response = await fetch(
    `https://${JIRA_DOMAIN}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`,
    {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    }
  );

  const data = await response.json();
  return data.issues?.map(i => ({
    id: i.id,
    key: i.key,
    summary: i.fields.summary,
    status: i.fields.status?.name,
    priority: i.fields.priority?.name,
    assignee: i.fields.assignee?.displayName,
    created: i.fields.created,
    updated: i.fields.updated
  })) || [];
}

/**
 * Create a Jira issue
 */
export async function jiraCreateIssue(projectKey, summary, description, issueType = 'Task') {
  if (!JIRA_TOKEN || !JIRA_DOMAIN) throw new Error('Jira not configured');

  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

  const response = await fetch(
    `https://${JIRA_DOMAIN}/rest/api/3/issue`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          summary,
          description: {
            type: 'doc',
            version: 1,
            content: [{
              type: 'paragraph',
              content: [{ type: 'text', text: description }]
            }]
          },
          issuetype: { name: issueType }
        }
      })
    }
  );

  const data = await response.json();
  return { id: data.id, key: data.key, self: data.self };
}

/**
 * Transition a Jira issue (change status)
 */
export async function jiraTransitionIssue(issueKey, transitionId) {
  if (!JIRA_TOKEN || !JIRA_DOMAIN) throw new Error('Jira not configured');

  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

  const response = await fetch(
    `https://${JIRA_DOMAIN}/rest/api/3/issue/${issueKey}/transitions`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        transition: { id: transitionId }
      })
    }
  );

  return { transitioned: response.ok, issueKey };
}

// ============================================================================
// MONDAY.COM
// ============================================================================

async function mondayQuery(query, variables = {}) {
  if (!MONDAY_TOKEN) throw new Error('Monday not configured');

  const response = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Authorization': MONDAY_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });

  const data = await response.json();
  return data.data;
}

/**
 * Get Monday.com boards
 */
export async function mondayGetBoards() {
  const query = `
    query {
      boards {
        id
        name
        state
        board_folder_id
      }
    }
  `;

  const data = await mondayQuery(query);
  return data?.boards || [];
}

/**
 * Get items from a Monday.com board
 */
export async function mondayGetItems(boardId, limit = 50) {
  const query = `
    query ($boardId: ID!, $limit: Int) {
      boards(ids: [$boardId]) {
        items_page(limit: $limit) {
          items {
            id
            name
            state
            column_values {
              id
              text
            }
          }
        }
      }
    }
  `;

  const data = await mondayQuery(query, { boardId, limit });
  return data?.boards?.[0]?.items_page?.items || [];
}

/**
 * Create a Monday.com item
 */
export async function mondayCreateItem(boardId, itemName, columnValues = {}) {
  const query = `
    mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON) {
      create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
        id
        name
      }
    }
  `;

  const data = await mondayQuery(query, {
    boardId,
    itemName,
    columnValues: JSON.stringify(columnValues)
  });

  return data?.create_item;
}

// ============================================================================
// HUBSPOT
// ============================================================================

/**
 * Search HubSpot contacts
 */
export async function hubspotSearchContacts(query, properties = ['email', 'firstname', 'lastname']) {
  if (!HUBSPOT_TOKEN) throw new Error('HubSpot not configured');

  const response = await fetch(
    'https://api.hubapi.com/crm/v3/objects/contacts/search',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query,
        properties,
        limit: 20
      })
    }
  );

  const data = await response.json();
  return data.results?.map(c => ({
    id: c.id,
    properties: c.properties,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  })) || [];
}

/**
 * Create a HubSpot contact
 */
export async function hubspotCreateContact(email, properties = {}) {
  if (!HUBSPOT_TOKEN) throw new Error('HubSpot not configured');

  const response = await fetch(
    'https://api.hubapi.com/crm/v3/objects/contacts',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: { email, ...properties }
      })
    }
  );

  const data = await response.json();
  return { id: data.id, properties: data.properties };
}

/**
 * Get HubSpot deals
 */
export async function hubspotGetDeals(properties = ['dealname', 'amount', 'dealstage']) {
  if (!HUBSPOT_TOKEN) throw new Error('HubSpot not configured');

  const response = await fetch(
    `https://api.hubapi.com/crm/v3/objects/deals?properties=${properties.join(',')}`,
    {
      headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}` }
    }
  );

  const data = await response.json();
  return data.results || [];
}

// ============================================================================
// STRIPE
// ============================================================================

/**
 * List Stripe payments
 */
export async function stripeListPayments(limit = 20) {
  if (!STRIPE_SECRET_KEY) throw new Error('Stripe not configured');

  const response = await fetch(
    `https://api.stripe.com/v1/payment_intents?limit=${limit}`,
    {
      headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` }
    }
  );

  const data = await response.json();
  return data.data?.map(p => ({
    id: p.id,
    amount: p.amount / 100,
    currency: p.currency,
    status: p.status,
    description: p.description,
    created: new Date(p.created * 1000).toISOString()
  })) || [];
}

/**
 * Get Stripe revenue summary
 */
export async function stripeGetRevenue(days = 30) {
  if (!STRIPE_SECRET_KEY) throw new Error('Stripe not configured');

  const startDate = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);

  const response = await fetch(
    `https://api.stripe.com/v1/payment_intents?limit=100&created[gte]=${startDate}`,
    {
      headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` }
    }
  );

  const data = await response.json();
  const succeeded = data.data?.filter(p => p.status === 'succeeded') || [];

  const totalRevenue = succeeded.reduce((sum, p) => sum + p.amount, 0) / 100;
  const byCurrency = {};

  for (const p of succeeded) {
    byCurrency[p.currency] = (byCurrency[p.currency] || 0) + p.amount / 100;
  }

  return {
    totalRevenue,
    transactionCount: succeeded.length,
    byCurrency,
    period: `${days} days`
  };
}

/**
 * Get Stripe customers
 */
export async function stripeListCustomers(limit = 20) {
  if (!STRIPE_SECRET_KEY) throw new Error('Stripe not configured');

  const response = await fetch(
    `https://api.stripe.com/v1/customers?limit=${limit}`,
    {
      headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` }
    }
  );

  const data = await response.json();
  return data.data?.map(c => ({
    id: c.id,
    email: c.email,
    name: c.name,
    created: new Date(c.created * 1000).toISOString()
  })) || [];
}

export default {
  getStatus,
  // Notion
  notionSearch,
  notionGetPage,
  notionCreatePage,
  notionQueryDatabase,
  // Linear
  linearListIssues,
  linearCreateIssue,
  linearUpdateIssue,
  linearGetTeams,
  // Airtable
  airtableListRecords,
  airtableCreateRecord,
  airtableUpdateRecord,
  // Jira
  jiraSearchIssues,
  jiraCreateIssue,
  jiraTransitionIssue,
  // Monday
  mondayGetBoards,
  mondayGetItems,
  mondayCreateItem,
  // HubSpot
  hubspotSearchContacts,
  hubspotCreateContact,
  hubspotGetDeals,
  // Stripe
  stripeListPayments,
  stripeGetRevenue,
  stripeListCustomers
};
