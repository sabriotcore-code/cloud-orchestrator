// ============================================================================
// NEO4J KNOWLEDGE GRAPH SERVICE
// Relationship mapping and semantic reasoning across entities
// ============================================================================

import neo4j from 'neo4j-driver';

let driver = null;

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initNeo4j() {
  if (driver) return driver;

  const uri = process.env.NEO4J_URI;
  const user = process.env.NEO4J_USER || 'neo4j';
  const password = process.env.NEO4J_PASSWORD;

  if (!uri || !password) {
    console.log('[Neo4j] Not configured - NEO4J_URI and NEO4J_PASSWORD required');
    return null;
  }

  try {
    driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    console.log('[Neo4j] Connected to knowledge graph');
    return driver;
  } catch (error) {
    console.error('[Neo4j] Connection failed:', error.message);
    return null;
  }
}

export async function closeNeo4j() {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

// ============================================================================
// SESSION HELPER
// ============================================================================

async function runQuery(cypher, params = {}) {
  if (!driver) initNeo4j();
  if (!driver) throw new Error('Neo4j not configured');

  const session = driver.session();
  try {
    const result = await session.run(cypher, params);
    return result.records.map(r => r.toObject());
  } finally {
    await session.close();
  }
}

// ============================================================================
// SECURITY - Input Validation
// ============================================================================

// Valid Neo4j labels: alphanumeric and underscores only
const VALID_LABEL_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/;
const VALID_KEY_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/;

// Allowed labels whitelist (prevents injection via arbitrary labels)
const ALLOWED_LABELS = new Set([
  'Property', 'Person', 'Organization', 'User', 'Conversation', 'Fact',
  'Tenant', 'Lender', 'Contact', 'Document', 'Note', 'Task', 'Event'
]);

function validateLabel(label) {
  if (!label || typeof label !== 'string') {
    throw new Error('Invalid label: must be a non-empty string');
  }
  if (!VALID_LABEL_REGEX.test(label)) {
    throw new Error(`Invalid label: "${label}" contains invalid characters`);
  }
  if (!ALLOWED_LABELS.has(label)) {
    throw new Error(`Invalid label: "${label}" is not in the allowed list`);
  }
  return label;
}

function validateKey(key) {
  if (!key || typeof key !== 'string') {
    throw new Error('Invalid key: must be a non-empty string');
  }
  if (!VALID_KEY_REGEX.test(key)) {
    throw new Error(`Invalid key: "${key}" contains invalid characters`);
  }
  return key;
}

function validateRelationType(relType) {
  if (!relType || typeof relType !== 'string') {
    throw new Error('Invalid relationship type: must be a non-empty string');
  }
  // Relationship types: uppercase with underscores
  if (!/^[A-Z][A-Z0-9_]*$/.test(relType)) {
    throw new Error(`Invalid relationship type: "${relType}" must be UPPERCASE_WITH_UNDERSCORES`);
  }
  return relType;
}

// ============================================================================
// ENTITY OPERATIONS
// ============================================================================

/**
 * Create or update an entity node
 */
export async function upsertEntity(label, properties, uniqueKey = 'id') {
  // Validate inputs to prevent Cypher injection
  validateLabel(label);
  validateKey(uniqueKey);

  // Validate property keys
  for (const key of Object.keys(properties)) {
    validateKey(key);
  }

  const propString = Object.keys(properties)
    .map(k => `${k}: $${k}`)
    .join(', ');

  const cypher = `
    MERGE (n:${label} {${uniqueKey}: $${uniqueKey}})
    SET n += {${propString}}
    RETURN n
  `;

  const result = await runQuery(cypher, properties);
  return result[0]?.n?.properties;
}

/**
 * Create a relationship between two entities
 */
export async function createRelationship(
  fromLabel, fromId,
  toLabel, toId,
  relType,
  properties = {}
) {
  // Validate inputs to prevent Cypher injection
  validateLabel(fromLabel);
  validateLabel(toLabel);
  validateRelationType(relType);
  for (const key of Object.keys(properties)) {
    validateKey(key);
  }

  const propString = Object.keys(properties).length > 0
    ? `{${Object.keys(properties).map(k => `${k}: $${k}`).join(', ')}}`
    : '';

  const cypher = `
    MATCH (a:${fromLabel} {id: $fromId})
    MATCH (b:${toLabel} {id: $toId})
    MERGE (a)-[r:${relType} ${propString}]->(b)
    RETURN a, r, b
  `;

  return runQuery(cypher, { fromId, toId, ...properties });
}

/**
 * Find entities by label and properties
 */
export async function findEntities(label, filters = {}, limit = 100) {
  // Validate inputs to prevent Cypher injection
  validateLabel(label);
  for (const key of Object.keys(filters)) {
    validateKey(key);
  }
  // Validate limit is a safe integer
  const safeLimit = Math.min(Math.max(1, parseInt(limit) || 100), 1000);

  const whereClause = Object.keys(filters).length > 0
    ? 'WHERE ' + Object.keys(filters).map(k => `n.${k} = $${k}`).join(' AND ')
    : '';

  const cypher = `
    MATCH (n:${label})
    ${whereClause}
    RETURN n
    LIMIT ${safeLimit}
  `;

  const result = await runQuery(cypher, filters);
  return result.map(r => r.n.properties);
}

/**
 * Get entity with all relationships
 */
export async function getEntityWithRelations(label, id, depth = 1) {
  // Validate inputs to prevent Cypher injection
  validateLabel(label);
  // Validate depth is a safe integer (1-5)
  const safeDepth = Math.min(Math.max(1, parseInt(depth) || 1), 5);

  const cypher = `
    MATCH (n:${label} {id: $id})
    OPTIONAL MATCH path = (n)-[*1..${safeDepth}]-(related)
    RETURN n, collect(distinct {
      node: related,
      relationship: [r in relationships(path) | type(r)]
    }) as connections
  `;

  const result = await runQuery(cypher, { id });
  if (!result.length) return null;

  return {
    entity: result[0].n.properties,
    connections: result[0].connections
      .filter(c => c.node)
      .map(c => ({
        ...c.node.properties,
        _relationships: c.relationship
      }))
  };
}

// ============================================================================
// GRAPH QUERIES
// ============================================================================

/**
 * Find shortest path between two entities
 */
export async function findPath(fromLabel, fromId, toLabel, toId) {
  const cypher = `
    MATCH (start:${fromLabel} {id: $fromId}), (end:${toLabel} {id: $toId})
    MATCH path = shortestPath((start)-[*..10]-(end))
    RETURN path
  `;

  const result = await runQuery(cypher, { fromId, toId });
  if (!result.length) return null;

  const path = result[0].path;
  return {
    nodes: path.segments.map(s => s.start.properties).concat([path.end.properties]),
    relationships: path.segments.map(s => s.relationship.type)
  };
}

/**
 * Find all connections of a specific type
 */
export async function findByRelationship(label, relType, direction = 'both') {
  const arrow = direction === 'outgoing' ? '->' : direction === 'incoming' ? '<-' : '-';
  const cypher = `
    MATCH (n:${label})${direction === 'incoming' ? '<' : ''}-[r:${relType}]-${direction === 'outgoing' ? '>' : ''}(related)
    RETURN n, r, related
    LIMIT 100
  `;

  return runQuery(cypher);
}

/**
 * Semantic similarity search (requires vector index)
 */
export async function vectorSearch(label, embedding, topK = 10) {
  const cypher = `
    CALL db.index.vector.queryNodes('${label.toLowerCase()}_embedding', ${topK}, $embedding)
    YIELD node, score
    RETURN node, score
  `;

  return runQuery(cypher, { embedding });
}

// ============================================================================
// REI-SPECIFIC OPERATIONS
// ============================================================================

/**
 * Create property node with all relationships
 */
export async function createProperty(property) {
  // Create property node
  await upsertEntity('Property', {
    id: property.reid || property.id,
    address: property.address,
    city: property.city,
    state: property.state,
    status: property.status,
    type: property.invType || property.type,
    loanBalance: property.loanBalance,
    currentValue: property.currentValue
  });

  // Link to tenant if exists
  if (property.tenantName) {
    await upsertEntity('Person', {
      id: `tenant_${property.reid}`,
      name: property.tenantName,
      type: 'tenant'
    });
    await createRelationship('Property', property.reid, 'Person', `tenant_${property.reid}`, 'HAS_TENANT');
  }

  // Link to lender if exists
  if (property.lender) {
    await upsertEntity('Organization', {
      id: `lender_${property.lender.replace(/\s/g, '_')}`,
      name: property.lender,
      type: 'lender'
    });
    await createRelationship('Property', property.reid, 'Organization', `lender_${property.lender.replace(/\s/g, '_')}`, 'FINANCED_BY');
  }

  return property;
}

/**
 * Find properties connected to a person/org
 */
export async function findConnectedProperties(entityId) {
  const cypher = `
    MATCH (e {id: $entityId})-[r]-(p:Property)
    RETURN p, type(r) as relationship
  `;

  const result = await runQuery(cypher, { entityId });
  return result.map(r => ({
    ...r.p.properties,
    relationship: r.relationship
  }));
}

/**
 * Get property network (all related entities)
 */
export async function getPropertyNetwork(reid, depth = 2) {
  return getEntityWithRelations('Property', reid, depth);
}

/**
 * Find similar properties by shared attributes
 */
export async function findSimilarProperties(reid, attributes = ['city', 'status', 'type']) {
  const attrMatch = attributes.map(a => `p1.${a} = p2.${a}`).join(' OR ');

  const cypher = `
    MATCH (p1:Property {id: $reid})
    MATCH (p2:Property)
    WHERE p2.id <> $reid AND (${attrMatch})
    RETURN p2,
           [attr IN $attributes WHERE p1[attr] = p2[attr]] as matchingAttrs
    ORDER BY size(matchingAttrs) DESC
    LIMIT 10
  `;

  const result = await runQuery(cypher, { reid, attributes });
  return result.map(r => ({
    ...r.p2.properties,
    matchingAttributes: r.matchingAttrs
  }));
}

// ============================================================================
// AI CONTEXT OPERATIONS
// ============================================================================

/**
 * Store AI conversation as knowledge
 */
export async function storeConversation(conversationId, userId, topic, summary) {
  await upsertEntity('Conversation', {
    id: conversationId,
    userId,
    topic,
    summary,
    timestamp: new Date().toISOString()
  });

  // Link to user
  await upsertEntity('User', { id: userId, type: 'user' });
  await createRelationship('User', userId, 'Conversation', conversationId, 'HAD_CONVERSATION');

  return { conversationId, userId, topic };
}

/**
 * Store learned fact/preference
 */
export async function storeFact(factId, content, source, confidence = 1.0) {
  await upsertEntity('Fact', {
    id: factId,
    content,
    source,
    confidence,
    learnedAt: new Date().toISOString()
  });

  return { factId, content };
}

/**
 * Query knowledge graph for context
 */
export async function queryKnowledge(query, labels = ['Fact', 'Conversation', 'Property']) {
  const labelMatch = labels.map(l => `n:${l}`).join(' OR ');

  const cypher = `
    MATCH (n)
    WHERE (${labelMatch})
    AND (toLower(n.content) CONTAINS toLower($query)
         OR toLower(n.summary) CONTAINS toLower($query)
         OR toLower(n.address) CONTAINS toLower($query)
         OR toLower(n.topic) CONTAINS toLower($query))
    RETURN n
    LIMIT 20
  `;

  const result = await runQuery(cypher, { query });
  return result.map(r => r.n.properties);
}

// ============================================================================
// SCHEMA SETUP
// ============================================================================

export async function setupSchema() {
  const constraints = [
    'CREATE CONSTRAINT property_id IF NOT EXISTS FOR (p:Property) REQUIRE p.id IS UNIQUE',
    'CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE',
    'CREATE CONSTRAINT org_id IF NOT EXISTS FOR (o:Organization) REQUIRE o.id IS UNIQUE',
    'CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE',
    'CREATE CONSTRAINT conversation_id IF NOT EXISTS FOR (c:Conversation) REQUIRE c.id IS UNIQUE',
    'CREATE CONSTRAINT fact_id IF NOT EXISTS FOR (f:Fact) REQUIRE f.id IS UNIQUE'
  ];

  const indexes = [
    'CREATE INDEX property_status IF NOT EXISTS FOR (p:Property) ON (p.status)',
    'CREATE INDEX property_city IF NOT EXISTS FOR (p:Property) ON (p.city)',
    'CREATE INDEX fact_source IF NOT EXISTS FOR (f:Fact) ON (f.source)'
  ];

  for (const constraint of constraints) {
    try {
      await runQuery(constraint);
    } catch (e) {
      // Constraint may already exist
    }
  }

  for (const index of indexes) {
    try {
      await runQuery(index);
    } catch (e) {
      // Index may already exist
    }
  }

  console.log('[Neo4j] Schema setup complete');
}

// ============================================================================
// STATUS
// ============================================================================

export function getNeo4jStatus() {
  return {
    connected: !!driver,
    uri: process.env.NEO4J_URI ? 'configured' : 'not configured'
  };
}

export default {
  initNeo4j,
  closeNeo4j,
  upsertEntity,
  createRelationship,
  findEntities,
  getEntityWithRelations,
  findPath,
  findByRelationship,
  vectorSearch,
  createProperty,
  findConnectedProperties,
  getPropertyNetwork,
  findSimilarProperties,
  storeConversation,
  storeFact,
  queryKnowledge,
  setupSchema,
  getNeo4jStatus
};
