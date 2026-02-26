import { pool } from '../db/pool';
import { logger } from '../logger';

export interface ChainStep {
  agentId: string;
  label?: string;
  condition?: string;
  passContext?: boolean;
}

export interface ChainDef {
  id: string;
  name: string;
  description: string;
  steps: ChainStep[];
  icon: string;
  category: string;
  difficulty: string;
  authorId?: string;
  authorName?: string;
  openSource?: boolean;
  public?: boolean;
  featured?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

const BUILT_IN_CHAINS: ChainDef[] = [
  {
    id: 'factory-health-check',
    name: 'Factory Health Check',
    description: 'Complete factory health check: OEE analysis, quality monitoring, and capacity optimization in sequence.',
    steps: [
      { agentId: 'oee-monitor', label: 'Check OEE', passContext: true },
      { agentId: 'quality-guard', label: 'Quality Check', condition: 'previous_found_issues', passContext: true },
      { agentId: 'capacity-agent', label: 'Optimize Capacity', passContext: true },
    ],
    icon: '🏭',
    category: 'Production',
    difficulty: 'Beginner',
    featured: true,
    openSource: true,
  },
  {
    id: 'delivery-risk-pipeline',
    name: 'Delivery Risk Pipeline',
    description: 'Detect delivery risks end-to-end: check deadlines, verify material availability, then optimize capacity.',
    steps: [
      { agentId: 'deadline-agent', label: 'Check Deadlines', passContext: true },
      { agentId: 'material-agent', label: 'Verify Materials', condition: 'orders_at_risk', passContext: true },
      { agentId: 'capacity-agent', label: 'Capacity Fix', condition: 'previous_found_issues', passContext: true },
    ],
    icon: '🚚',
    category: 'Delivery',
    difficulty: 'Intermediate',
    featured: true,
    openSource: true,
  },
  {
    id: 'nightly-review',
    name: 'Nightly Review',
    description: 'Comprehensive nightly review: strategic planning, energy analysis, and quality audit.',
    steps: [
      { agentId: 'strategic-planner', label: 'Strategic Review', passContext: true },
      { agentId: 'energy-optimizer', label: 'Energy Audit', passContext: true },
      { agentId: 'quality-guard', label: 'Quality Audit', passContext: true },
    ],
    icon: '🌙',
    category: 'Planning',
    difficulty: 'Advanced',
    featured: true,
    openSource: true,
  },
];

function rowToChain(row: any): ChainDef {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    steps: typeof row.steps === 'string' ? JSON.parse(row.steps) : row.steps,
    icon: row.icon || '🔗',
    category: row.category || 'General',
    difficulty: row.difficulty || 'Intermediate',
    authorId: row.author_id,
    authorName: row.author_name,
    openSource: row.open_source ?? false,
    public: row.public ?? true,
    featured: row.featured ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getAllChains(): Promise<ChainDef[]> {
  try {
    const result = await pool.query(
      `SELECT c.*, u.name as author_name FROM agent_chains c LEFT JOIN users u ON c.author_id = u.id WHERE c.public = true ORDER BY c.created_at DESC`
    );
    const dbChains = result.rows.map(rowToChain);
    const builtInIds = new Set(BUILT_IN_CHAINS.map(c => c.id));
    const community = dbChains.filter(c => !builtInIds.has(c.id));
    return [...BUILT_IN_CHAINS, ...community];
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to load chains from DB');
    return BUILT_IN_CHAINS;
  }
}

export async function getChain(id: string): Promise<ChainDef | undefined> {
  const builtIn = BUILT_IN_CHAINS.find(c => c.id === id);
  if (builtIn) return builtIn;

  try {
    const result = await pool.query(
      `SELECT c.*, u.name as author_name FROM agent_chains c LEFT JOIN users u ON c.author_id = u.id WHERE c.id = $1`,
      [id]
    );
    if (result.rows.length === 0) return undefined;
    return rowToChain(result.rows[0]);
  } catch {
    return undefined;
  }
}

export async function createChain(chain: {
  id: string;
  name: string;
  description: string;
  steps: ChainStep[];
  icon: string;
  category: string;
  difficulty: string;
  authorId: string;
  openSource?: boolean;
}): Promise<ChainDef> {
  const result = await pool.query(
    `INSERT INTO agent_chains (id, name, description, steps, icon, category, difficulty, author_id, open_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *, (SELECT name FROM users WHERE id = $8) as author_name`,
    [chain.id, chain.name, chain.description, JSON.stringify(chain.steps), chain.icon, chain.category, chain.difficulty, chain.authorId, chain.openSource ?? false]
  );
  return rowToChain(result.rows[0]);
}

export async function updateChain(id: string, userId: string, updates: Partial<{
  name: string;
  description: string;
  steps: ChainStep[];
  icon: string;
  category: string;
  difficulty: string;
  openSource: boolean;
}>): Promise<ChainDef | null> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.name) { fields.push(`name = $${idx++}`); values.push(updates.name); }
  if (updates.description) { fields.push(`description = $${idx++}`); values.push(updates.description); }
  if (updates.steps) { fields.push(`steps = $${idx++}`); values.push(JSON.stringify(updates.steps)); }
  if (updates.icon) { fields.push(`icon = $${idx++}`); values.push(updates.icon); }
  if (updates.category) { fields.push(`category = $${idx++}`); values.push(updates.category); }
  if (updates.difficulty) { fields.push(`difficulty = $${idx++}`); values.push(updates.difficulty); }
  if (updates.openSource !== undefined) { fields.push(`open_source = $${idx++}`); values.push(updates.openSource); }

  if (fields.length === 0) return null;

  fields.push(`updated_at = NOW()`);
  values.push(id, userId);

  const result = await pool.query(
    `UPDATE agent_chains SET ${fields.join(', ')} WHERE id = $${idx++} AND author_id = $${idx++}
     RETURNING *, (SELECT name FROM users WHERE id = agent_chains.author_id) as author_name`,
    values
  );
  if (result.rows.length === 0) return null;
  return rowToChain(result.rows[0]);
}

export async function deleteChain(id: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM agent_chains WHERE id = $1 AND author_id = $2`,
    [id, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getUserChains(userId: string): Promise<ChainDef[]> {
  const result = await pool.query(
    `SELECT c.*, u.name as author_name FROM agent_chains c LEFT JOIN users u ON c.author_id = u.id WHERE c.author_id = $1 ORDER BY c.created_at DESC`,
    [userId]
  );
  return result.rows.map(rowToChain);
}
