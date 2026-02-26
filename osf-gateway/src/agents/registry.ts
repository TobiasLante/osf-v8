import { pool } from '../db/pool';
import { logger } from '../logger';

export interface AgentDef {
  id: string;
  name: string;
  type: 'operational' | 'langgraph' | 'strategic';
  category: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert';
  icon: string;
  authorId?: string;
  authorName?: string;
  featured?: boolean;
  openSource?: boolean;
}

// Built-in agents (always available, cannot be deleted)
const BUILT_IN_AGENTS: AgentDef[] = [
  {
    id: 'oee-monitor',
    name: 'OEE Monitor',
    type: 'operational',
    category: 'Production',
    description: 'Monitors OEE across all machines, detects drops, and suggests corrective actions.',
    systemPrompt: `You are an OEE monitoring agent for a manufacturing factory. Your job is to:
1. Check current OEE values for all machines
2. Identify machines with OEE below target (85%)
3. Analyze the root causes (availability, performance, quality)
4. Suggest specific corrective actions

Start by getting the latest OEE data, then analyze each machine. Focus on actionable insights.`,
    tools: ['factory_get_latest_oee', 'factory_get_machine_oee', 'factory_get_production_history', 'factory_get_scrap_history'],
    difficulty: 'Beginner',
    icon: '📊',
    featured: true,
  },
  {
    id: 'material-agent',
    name: 'Material Agent',
    type: 'langgraph',
    category: 'Supply Chain',
    description: 'Detects material shortages, checks stock levels, and creates purchase suggestions.',
    systemPrompt: `You are a material management agent. Your responsibilities:
1. Check for low stock items and material shortages
2. Review pending purchase orders
3. Cross-reference with upcoming work orders
4. Recommend purchase actions for critical materials

Start with low stock items, then check pending purchases and upcoming demand.`,
    tools: ['factory_get_stock_item', 'factory_get_low_stock_items', 'factory_get_pending_purchases', 'factory_get_md04', 'factory_get_md07'],
    difficulty: 'Intermediate',
    icon: '📦',
    featured: true,
  },
  {
    id: 'capacity-agent',
    name: 'Capacity Agent',
    type: 'langgraph',
    category: 'Production',
    description: 'Resolves blocked orders, balances workload across machines, optimizes capacity utilization.',
    systemPrompt: `You are a capacity management agent. Your tasks:
1. Get capacity overview for all machines
2. Identify blocked or overloaded machines
3. Check CM21 orders that need rescheduling
4. Suggest load balancing actions

Start with the capacity overview, then look at blocked orders and machine queues.`,
    tools: ['factory_get_capacity_overview', 'factory_get_cm01', 'factory_get_cm21_orders', 'factory_get_blocked_orders_count', 'factory_get_machine_queue'],
    difficulty: 'Intermediate',
    icon: '⚙️',
    featured: true,
  },
  {
    id: 'deadline-agent',
    name: 'Deadline Agent',
    type: 'langgraph',
    category: 'Delivery',
    description: 'Monitors delivery deadlines, prioritizes at-risk orders, ensures on-time delivery.',
    systemPrompt: `You are a delivery deadline monitoring agent. Your focus:
1. Check orders at risk of missing their delivery date
2. Review customer OTD (on-time delivery) rates
3. Verify material readiness for critical orders
4. Recommend priority changes or expediting actions

Start with at-risk orders, then check customer OTD metrics.`,
    tools: ['factory_get_orders_at_risk', 'factory_get_customer_otd', 'factory_check_material_readiness', 'factory_get_va05_summary', 'factory_get_customer_orders'],
    difficulty: 'Intermediate',
    icon: '⏰',
    featured: true,
  },
  {
    id: 'quality-guard',
    name: 'Quality Guard',
    type: 'operational',
    category: 'Quality',
    description: 'Monitors SPC alarms, Cpk values, calibration status, and quality notifications.',
    systemPrompt: `You are a quality management agent. Your responsibilities:
1. Check for active SPC alarms across all characteristics
2. Review Cpk values — flag any below 1.33
3. Check calibration due dates for all gauges
4. Summarize quality status and recommend actions

Start with SPC alarms, then review Cpk overview and calibration status.`,
    tools: ['factory_get_spc_alarms', 'factory_get_cpk_overview', 'factory_get_calibration_due', 'factory_get_quality_notifications'],
    difficulty: 'Advanced',
    icon: '🔍',
    featured: true,
  },
  {
    id: 'energy-optimizer',
    name: 'Energy Optimizer',
    type: 'operational',
    category: 'Sustainability',
    description: 'Analyzes energy consumption per machine and per part, identifies optimization potential.',
    systemPrompt: `You are an energy optimization agent. Your analysis:
1. Get overall energy consumption overview
2. Check energy per part for each machine
3. Analyze base load patterns
4. Identify high-consumption machines and optimization opportunities

Start with the energy overview, then drill into per-part metrics.`,
    tools: ['factory_get_energy_overview', 'factory_get_energy_per_part', 'factory_get_base_load', 'factory_get_machine_energy', 'factory_get_energy_costs', 'factory_get_energy_trend'],
    difficulty: 'Beginner',
    icon: '⚡',
    featured: true,
  },
  {
    id: 'warehouse',
    name: 'Warehouse Agent',
    type: 'operational',
    category: 'Supply Chain',
    description: 'Lagerverwaltung: Bestaende, Nachbestellungen, Lieferantenbewertung und Materialverfuegbarkeit.',
    systemPrompt: `Du bist der Warehouse Agent fuer die Lagerverwaltung.

Deine Aufgaben:
1. Pruefe aktuelle Bestandslevel und Reichweiten
2. Identifiziere Niedrigbestaende und Nachbestellbedarf
3. Bewerte Lieferanten-Performance
4. Pruefe Materialverfuegbarkeit fuer anstehende Auftraege

Starte mit factory_get_low_stock_items, dann analysiere Lieferanten und Verfuegbarkeit.`,
    tools: [
      'factory_get_stock_item', 'factory_get_low_stock_items',
      'factory_get_supplier_evaluation', 'factory_get_supplier_for_material',
      'factory_get_pending_purchases', 'factory_check_material_readiness',
    ],
    difficulty: 'Beginner',
    icon: '📦',
    featured: true,
  },
];

// Merge built-in + DB agents
export async function getAllAgents(): Promise<AgentDef[]> {
  try {
    const result = await pool.query(
      `SELECT a.*, u.name as author_name FROM agents a LEFT JOIN users u ON a.author_id = u.id WHERE a.public = true ORDER BY a.created_at DESC`
    );
    const dbAgents: AgentDef[] = result.rows.map(rowToAgent);
    // Built-in first, then community (DB) agents — skip DB dupes of built-in IDs
    const builtInIds = new Set(BUILT_IN_AGENTS.map(a => a.id));
    const community = dbAgents.filter(a => !builtInIds.has(a.id));
    return [...BUILT_IN_AGENTS, ...community];
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to load agents from DB, using built-in only');
    return BUILT_IN_AGENTS;
  }
}

export async function getAgent(id: string): Promise<AgentDef | undefined> {
  // Check built-in first
  const builtIn = BUILT_IN_AGENTS.find(a => a.id === id);
  if (builtIn) return builtIn;

  // Then DB
  try {
    const result = await pool.query(
      `SELECT a.*, u.name as author_name FROM agents a LEFT JOIN users u ON a.author_id = u.id WHERE a.id = $1`,
      [id]
    );
    if (result.rows.length === 0) return undefined;
    return rowToAgent(result.rows[0]);
  } catch {
    return undefined;
  }
}

export async function getUserAgents(userId: string): Promise<AgentDef[]> {
  const result = await pool.query(
    `SELECT a.*, u.name as author_name FROM agents a LEFT JOIN users u ON a.author_id = u.id WHERE a.author_id = $1 ORDER BY a.created_at DESC`,
    [userId]
  );
  return result.rows.map(rowToAgent);
}

export async function createAgent(agent: {
  id: string;
  name: string;
  type: string;
  category: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  difficulty: string;
  icon: string;
  authorId: string;
  openSource?: boolean;
}): Promise<AgentDef> {
  const result = await pool.query(
    `INSERT INTO agents (id, name, type, category, description, system_prompt, tools, difficulty, icon, author_id, open_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *, (SELECT name FROM users WHERE id = $10) as author_name`,
    [agent.id, agent.name, agent.type, agent.category, agent.description, agent.systemPrompt, agent.tools, agent.difficulty, agent.icon, agent.authorId, agent.openSource ?? false]
  );
  return rowToAgent(result.rows[0]);
}

export async function updateAgent(id: string, userId: string, updates: Partial<{
  name: string;
  type: string;
  category: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  difficulty: string;
  icon: string;
  openSource: boolean;
}>): Promise<AgentDef | null> {
  // Only owner can update
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.name) { fields.push(`name = $${idx++}`); values.push(updates.name); }
  if (updates.type) { fields.push(`type = $${idx++}`); values.push(updates.type); }
  if (updates.category) { fields.push(`category = $${idx++}`); values.push(updates.category); }
  if (updates.description) { fields.push(`description = $${idx++}`); values.push(updates.description); }
  if (updates.systemPrompt) { fields.push(`system_prompt = $${idx++}`); values.push(updates.systemPrompt); }
  if (updates.tools) { fields.push(`tools = $${idx++}`); values.push(updates.tools); }
  if (updates.difficulty) { fields.push(`difficulty = $${idx++}`); values.push(updates.difficulty); }
  if (updates.icon) { fields.push(`icon = $${idx++}`); values.push(updates.icon); }
  if (updates.openSource !== undefined) { fields.push(`open_source = $${idx++}`); values.push(updates.openSource); }

  if (fields.length === 0) return null;

  fields.push(`updated_at = NOW()`);
  values.push(id, userId);

  const result = await pool.query(
    `UPDATE agents SET ${fields.join(', ')} WHERE id = $${idx++} AND author_id = $${idx++}
     RETURNING *, (SELECT name FROM users WHERE id = agents.author_id) as author_name`,
    values
  );
  if (result.rows.length === 0) return null;
  return rowToAgent(result.rows[0]);
}

export async function deleteAgent(id: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM agents WHERE id = $1 AND author_id = $2`,
    [id, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

function rowToAgent(row: any): AgentDef {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    category: row.category,
    description: row.description,
    systemPrompt: row.system_prompt,
    tools: row.tools || [],
    difficulty: row.difficulty,
    icon: row.icon || '🤖',
    authorId: row.author_id,
    authorName: row.author_name,
    featured: false,
    openSource: row.open_source ?? false,
  };
}
