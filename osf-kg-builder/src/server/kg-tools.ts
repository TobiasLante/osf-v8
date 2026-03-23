import { cypherQuery, validateLabel } from '../shared/cypher-utils';
import { generateChart } from './chart-engine';
import { generateEmbedding } from '../shared/embedding-service';
import { semanticSearch } from '../shared/vector-store';
import { loadDomainConfig, loadSchemaTemplate } from '../shared/domain-config';
import { logger } from '../shared/logger';

// ── Tool Definitions ───────────────────────────────────────────────

export interface KgToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
}

export const KG_TOOLS: KgToolDef[] = [
  {
    name: 'kg_impact',
    description: 'Find all nodes impacted by a given node (downstream, up to 3 hops)',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'ID of the source node' },
      },
      required: ['node_id'],
    },
  },
  {
    name: 'kg_path',
    description: 'Find the shortest path between two nodes in the Knowledge Graph',
    inputSchema: {
      type: 'object',
      properties: {
        from_id: { type: 'string', description: 'ID of the start node' },
        to_id: { type: 'string', description: 'ID of the end node' },
      },
      required: ['from_id', 'to_id'],
    },
  },
  {
    name: 'kg_neighbors',
    description: 'Get all neighbor nodes within a given depth',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'ID of the center node' },
        depth: { type: 'number', description: 'Max traversal depth (1-5, default 2)' },
      },
      required: ['node_id'],
    },
  },
  {
    name: 'kg_aggregate',
    description: 'Aggregate a numeric property across all nodes of a given label (avg, min, max, count)',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Node label (e.g. Machine, Order)' },
        property: { type: 'string', description: 'Numeric property to aggregate (e.g. oee, quantity)' },
      },
      required: ['label', 'property'],
    },
  },
  {
    name: 'kg_search',
    description: 'Semantic search — find KG nodes by natural language query using vector embeddings',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        limit: { type: 'number', description: 'Max results (default 10)' },
        label_filter: { type: 'string', description: 'Optional: only search nodes with this label' },
      },
      required: ['query'],
    },
  },
  {
    name: 'kg_schema',
    description: 'Get the Knowledge Graph schema — all node labels, relationship types, and property keys',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'kg_subgraph',
    description: 'Extract a subgraph around a node within a given radius',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'ID of the center node' },
        radius: { type: 'number', description: 'Max radius (1-4, default 2)' },
      },
      required: ['node_id'],
    },
  },
  {
    name: 'kg_filter',
    description: 'Filter nodes by label and property conditions',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Node label to filter' },
        conditions: {
          type: 'object',
          description: 'Property conditions as key-value pairs. Use {prop: {gt: N}} for comparisons.',
        },
        limit: { type: 'number', description: 'Max results (default 50)' },
      },
      required: ['label'],
    },
  },
  {
    name: 'kg_query',
    description: 'Run a read-only Cypher query against the Knowledge Graph. Use for custom queries not covered by other tools.',
    inputSchema: {
      type: 'object',
      properties: {
        cypher: { type: 'string', description: 'Cypher query (read-only, no CREATE/DELETE/SET/MERGE)' },
        params: { type: 'object', description: 'Query parameters (optional)' },
      },
      required: ['cypher'],
    },
  },
  {
    name: 'kg_stats',
    description: 'Quick summary of the Knowledge Graph: total nodes, edges, top labels, top relationship types',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'kg_delivery_snapshot',
    description: 'Delivery feasibility snapshot — returns orders with linked materials, stock levels, machine capacity, OEE, and customer info in a single graph traversal. Use for quick delivery checks.',
    inputSchema: {
      type: 'object',
      properties: {
        days_ahead: { type: 'number', description: 'Look-ahead window in days (default 7)' },
      },
      required: [],
    },
  },
];

// ── Domain-Specific Tools (loaded from template) ──────────────────

let domainTools: KgToolDef[] = [];
const domainToolCyphers = new Map<string, string>();

/**
 * Load domain-specific tools from the active schema template.
 * Call once at server startup after domain config is loaded.
 */
export function loadDomainTools(): void {
  const domain = loadDomainConfig();
  const template = loadSchemaTemplate(domain.domain);
  if (!template?.tools || template.tools.length === 0) {
    logger.info({ domain: domain.domain }, 'No domain-specific tools in template');
    return;
  }

  domainTools = [];
  domainToolCyphers.clear();

  for (const tool of template.tools) {
    domainTools.push({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    });
    domainToolCyphers.set(tool.name, tool.cypher);
  }

  logger.info({ count: domainTools.length, domain: domain.domain }, 'Domain tools loaded');
}

/**
 * Get all available tools (generic + domain-specific).
 */
const CHART_TOOL: KgToolDef = {
  name: 'kg_generate_chart',
  description: 'Generate a chart visualization from a natural language question about the knowledge graph. Returns Chart.js compatible config with data. Use when user asks for trends, comparisons, or visualizations.',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'Natural language question for chart (e.g. "OEE trend for SGM-004", "top 10 machines by scrap rate")' },
    },
    required: ['question'],
  },
};

export function getAllTools(): KgToolDef[] {
  return [...KG_TOOLS, CHART_TOOL, ...domainTools];
}

/**
 * Execute a domain-specific tool by running its Cypher query with parameters.
 */
async function executeDomainTool(name: string, args: Record<string, any>): Promise<any> {
  const cypher = domainToolCyphers.get(name);
  if (!cypher) throw new Error(`Unknown domain tool: ${name}`);
  const rows = await cypherQuery(cypher, args);
  return { tool: name, results: rows, count: rows.length };
}

// ── Tool Execution ─────────────────────────────────────────────────

export async function executeTool(name: string, args: Record<string, any>): Promise<any> {
  switch (name) {
    case 'kg_impact':
      return executeImpact(args.node_id);
    case 'kg_path':
      return executePath(args.from_id, args.to_id);
    case 'kg_neighbors':
      return executeNeighbors(args.node_id, args.depth);
    case 'kg_aggregate':
      return executeAggregate(args.label, args.property);
    case 'kg_search':
      return executeSearch(args.query, args.limit, args.label_filter);
    case 'kg_schema':
      return executeSchema();
    case 'kg_subgraph':
      return executeSubgraph(args.node_id, args.radius);
    case 'kg_filter':
      return executeFilter(args.label, args.conditions, args.limit);
    case 'kg_query':
      return executeQuery(args.cypher, args.params);
    case 'kg_stats':
      return executeStats();
    case 'kg_generate_chart':
      return executeChart(args.question);
    case 'kg_delivery_snapshot':
      return executeDeliverySnapshot(args.days_ahead);
    default:
      // Fallback: try domain-specific tools
      if (domainToolCyphers.has(name)) {
        return executeDomainTool(name, args);
      }
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Individual Tool Implementations ────────────────────────────────

async function executeImpact(nodeId: string): Promise<any> {
  const rows = await cypherQuery(`
    MATCH (n {id: $id})-[r*1..3]->(a)
    RETURN DISTINCT a.id AS id, labels(a) AS labels, properties(a) AS props
    LIMIT 50
  `, { id: nodeId });
  return { source: nodeId, impacted: rows };
}

async function executePath(fromId: string, toId: string): Promise<any> {
  const rows = await cypherQuery(`
    MATCH p = shortestPath((a {id: $from})-[*..10]-(b {id: $to}))
    RETURN [n IN nodes(p) | {id: n.id, labels: labels(n)}] AS nodes,
           [r IN relationships(p) | {type: type(r), from: startNode(r).id, to: endNode(r).id}] AS edges
  `, { from: fromId, to: toId });

  if (rows.length === 0) return { from: fromId, to: toId, path: null, message: 'No path found' };
  return { from: fromId, to: toId, path: rows[0] };
}

async function executeNeighbors(nodeId: string, depth?: number): Promise<any> {
  const d = Math.min(Math.max(depth || 2, 1), 5);
  const rows = await cypherQuery(`
    MATCH (n {id: $id})-[r*1..${d}]-(m)
    RETURN DISTINCT m.id AS id, labels(m) AS labels, properties(m) AS props
    LIMIT 100
  `, { id: nodeId });
  return { center: nodeId, depth: d, neighbors: rows };
}

async function executeAggregate(label: string, property: string): Promise<any> {
  try { validateLabel(label); } catch { return { error: `Invalid label: ${label}` }; }
  const safeLabel = label;
  const safeProp = property.replace(/[^a-zA-Z0-9_]/g, '');

  const rows = await cypherQuery(`
    MATCH (n:${safeLabel})
    WHERE n.${safeProp} IS NOT NULL
    RETURN avg(toFloat(n.${safeProp})) AS avg,
           min(toFloat(n.${safeProp})) AS min,
           max(toFloat(n.${safeProp})) AS max,
           count(n) AS count,
           sum(toFloat(n.${safeProp})) AS sum
  `);
  return { label: safeLabel, property: safeProp, ...(rows[0] || {}) };
}

async function executeSearch(query: string, limit?: number, labelFilter?: string): Promise<any> {
  const embedding = await generateEmbedding(query);
  const results = await semanticSearch(embedding, limit || 10, 0.3, labelFilter);
  return { query, results };
}

async function executeSchema(): Promise<any> {
  const labelsResult = await cypherQuery('CALL db.labels() YIELD label RETURN collect(label) AS labels');
  const relsResult = await cypherQuery('CALL db.relationshipTypes() YIELD relationshipType RETURN collect(relationshipType) AS types');

  const labels = labelsResult[0]?.labels || labelsResult[0] || [];
  const relationshipTypes = relsResult[0]?.types || relsResult[0] || [];

  // Get property keys per label
  const labelDetails: Record<string, any> = {};
  for (const label of (Array.isArray(labels) ? labels : [labels])) {
    try {
      validateLabel(label);
      const propsResult = await cypherQuery(`MATCH (n:${label}) WITH n LIMIT 1 RETURN keys(n) AS keys`);
      const countResult = await cypherQuery(`MATCH (n:${label}) RETURN count(n) AS cnt`);
      labelDetails[label] = {
        properties: propsResult[0]?.keys || [],
        count: countResult[0]?.cnt || countResult[0] || 0,
      };
    } catch { /* label may not exist */ }
  }

  return { labels: labelDetails, relationshipTypes };
}

async function executeSubgraph(nodeId: string, radius?: number): Promise<any> {
  const r = Math.min(Math.max(radius || 2, 1), 4);
  const rows = await cypherQuery(`
    MATCH path = (n {id: $id})-[*1..${r}]-(m)
    WITH n, relationships(path) AS rels, m
    RETURN DISTINCT
      {id: n.id, labels: labels(n)} AS center,
      collect(DISTINCT {id: m.id, labels: labels(m), props: properties(m)}) AS nodes,
      [r IN collect(DISTINCT rels) | {type: type(head(r)), from: startNode(head(r)).id, to: endNode(head(r)).id}] AS edges
  `, { id: nodeId });

  if (rows.length === 0) return { center: nodeId, nodes: [], edges: [] };
  return rows[0];
}

async function executeQuery(cypher: string, params?: Record<string, any>): Promise<any> {
  // Block write operations
  if (/\b(DELETE|REMOVE|CREATE|DROP|SET|MERGE|DETACH|FOREACH|CALL\s*\{)\b/i.test(cypher)) {
    return { error: 'Write operations are not allowed. Use read-only Cypher.' };
  }
  const rows = await cypherQuery(cypher, params || {});
  return { cypher, results: rows.slice(0, 100), count: rows.length };
}

async function executeStats(): Promise<any> {
  const nodeCount = await cypherQuery('MATCH (n) RETURN count(n) AS total');
  const edgeCount = await cypherQuery('MATCH ()-[r]->() RETURN count(r) AS total');
  const topLabels = await cypherQuery('MATCH (n) RETURN labels(n)[0] AS label, count(*) AS cnt ORDER BY cnt DESC LIMIT 10');
  const topRels = await cypherQuery('MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS cnt ORDER BY cnt DESC LIMIT 10');

  return {
    totalNodes: nodeCount[0]?.total || 0,
    totalEdges: edgeCount[0]?.total || 0,
    topLabels,
    topRelationships: topRels,
  };
}

async function executeFilter(label: string, conditions?: Record<string, any>, limit?: number): Promise<any> {
  try { validateLabel(label); } catch { return { error: `Invalid label: ${label}` }; }
  const safeLabel = label;
  const maxResults = Math.min(limit || 50, 200);

  // Build WHERE clauses from conditions
  const whereParts: string[] = [];
  const params: Record<string, any> = {};
  let paramIdx = 0;

  if (conditions) {
    for (const [prop, val] of Object.entries(conditions)) {
      const safeProp = prop.replace(/[^a-zA-Z0-9_]/g, '');
      if (typeof val === 'object' && val !== null) {
        // Comparison operators: {gt: N, lt: N, gte: N, lte: N}
        if (val.gt !== undefined) { const p = `p${paramIdx++}`; whereParts.push(`n.${safeProp} > $${p}`); params[p] = val.gt; }
        if (val.gte !== undefined) { const p = `p${paramIdx++}`; whereParts.push(`n.${safeProp} >= $${p}`); params[p] = val.gte; }
        if (val.lt !== undefined) { const p = `p${paramIdx++}`; whereParts.push(`n.${safeProp} < $${p}`); params[p] = val.lt; }
        if (val.lte !== undefined) { const p = `p${paramIdx++}`; whereParts.push(`n.${safeProp} <= $${p}`); params[p] = val.lte; }
      } else {
        const p = `p${paramIdx++}`;
        whereParts.push(`n.${safeProp} = $${p}`);
        params[p] = val;
      }
    }
  }

  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
  const cypher = `MATCH (n:${safeLabel}) ${whereClause} RETURN properties(n) AS props LIMIT ${maxResults}`;

  const rows = await cypherQuery(cypher, params);
  return { label: safeLabel, count: rows.length, nodes: rows.map(r => r.props || r) };
}

async function executeChart(question: string): Promise<any> {
  // Load schema from Neo4j (auto-detect labels + edges)
  const nodeTypes = await cypherQuery(`
    MATCH (n) WITH labels(n)[0] AS label, keys(n) AS props
    RETURN label, collect(DISTINCT props) AS allProps LIMIT 20
  `);
  const edgeTypes = await cypherQuery(`
    MATCH (a)-[r]->(b) RETURN DISTINCT labels(a)[0] AS fromType, type(r) AS label, labels(b)[0] AS toType LIMIT 30
  `);

  const schema = {
    nodeTypes: nodeTypes.map((n: any) => ({
      label: n.label,
      properties: (n.allProps?.[0] || []).map((p: string) => ({ name: p, type: 'String' })),
    })),
    edgeTypes: edgeTypes.map((e: any) => ({ fromType: e.fromType, label: e.label, toType: e.toType })),
  };

  const result = await generateChart(question, schema as any);
  return { _chartConfig: result.chart, cypher: result.cypher, question: result.question };
}

async function executeDeliverySnapshot(daysAhead?: number): Promise<any> {
  const days = Math.min(Math.max(daysAhead || 7, 1), 30);

  // Single traversal: Order → Material/Stock, Order → Machine/OEE, Order → Customer
  const rows = await cypherQuery(`
    MATCH (o:Order)
    WHERE o.status IS NULL OR o.status <> 'completed'
    OPTIONAL MATCH (o)-[:HAS_BOM]->(m)
    OPTIONAL MATCH (o)-[:FOR_CUSTOMER]->(c)
    OPTIONAL MATCH (o)<-[:WORKS_ON]-(mach)
    WITH o, collect(DISTINCT {
      id: m.id, name: m.name, quantity: m.quantity,
      stock: m.stock, safety_stock: m.safety_stock,
      coverage_days: CASE WHEN m.daily_usage > 0 THEN toFloat(m.stock) / m.daily_usage ELSE null END
    }) AS materials,
    collect(DISTINCT {
      id: mach.id, name: mach.name, oee: mach.oee,
      availability: mach.availability, performance: mach.performance, quality: mach.quality,
      status: mach.status, utilization: mach.utilization
    }) AS machines,
    c
    RETURN o.id AS order_id, o.name AS order_name,
           o.due_date AS due_date, o.quantity AS order_qty,
           o.status AS order_status, o.priority AS priority,
           o.risk_score AS risk_score,
           c.id AS customer_id, c.name AS customer_name,
           materials, machines
    ORDER BY o.due_date ASC
    LIMIT 50
  `);

  // Separate query for shift/capacity info (not order-linked)
  const capacityRows = await cypherQuery(`
    MATCH (mach)
    WHERE any(l IN labels(mach) WHERE l ENDS WITH 'Machine' OR l = 'Machine')
    RETURN mach.id AS machine_id, mach.name AS machine_name,
           mach.oee AS oee, mach.availability AS availability,
           mach.performance AS performance, mach.quality AS quality,
           mach.utilization AS utilization, mach.status AS status,
           mach.shift_model AS shift_model, mach.scrap_rate AS scrap_rate
    ORDER BY mach.oee ASC
    LIMIT 20
  `);

  // Low-stock materials
  const lowStockRows = await cypherQuery(`
    MATCH (m)
    WHERE (m:Material OR m:Article) AND m.stock IS NOT NULL AND m.safety_stock IS NOT NULL
      AND m.stock < m.safety_stock
    RETURN m.id AS id, m.name AS name, m.stock AS stock,
           m.safety_stock AS safety_stock, m.unit AS unit
    ORDER BY toFloat(m.stock) / CASE WHEN m.safety_stock > 0 THEN m.safety_stock ELSE 1 END ASC
    LIMIT 20
  `);

  return {
    tool: 'kg_delivery_snapshot',
    days_ahead: days,
    orders: rows,
    machines: capacityRows,
    low_stock_materials: lowStockRows,
    summary: {
      total_orders: rows.length,
      total_machines: capacityRows.length,
      low_stock_count: lowStockRows.length,
    },
  };
}
