import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { pool } from '../db/pool';

interface Challenge {
  id: string;
  name: string;
  description: string;
  kpiGoal: string;
  timeLimit: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert';
  icon: string;
  rules: string[];
  systemPrompt: string;
  tools: string[];
}

const challenges: Challenge[] = [
  {
    id: 'oee-champion',
    name: 'OEE Champion',
    description: 'Achieve and maintain OEE above 85% across all machines for a full 24-hour simulated period.',
    kpiGoal: 'OEE > 85% over 24h',
    timeLimit: '1 hour',
    difficulty: 'Beginner',
    icon: '🏆',
    rules: [
      'All CNC and SGM machines must maintain OEE > 85%',
      'Measured over 24 simulated hours',
      'You may use any OEE, capacity, and maintenance tools',
      'No manual machine restarts allowed',
    ],
    systemPrompt: 'You are participating in the OEE Champion challenge. Your goal is to maintain OEE above 85% on all machines for 24 simulated hours. Monitor OEE, identify drops, and take corrective actions.',
    tools: ['factory_get_latest_oee', 'factory_get_machine_oee', 'factory_get_production_history', 'factory_get_capacity_overview'],
  },
  {
    id: 'zero-delay',
    name: 'Zero Delay',
    description: 'Ensure zero late deliveries over a 48-hour simulated window by managing priorities and capacity.',
    kpiGoal: '0 late deliveries in 48h',
    timeLimit: '2 hours',
    difficulty: 'Intermediate',
    icon: '🎯',
    rules: [
      'No customer orders may be delivered late',
      'Measured over 48 simulated hours',
      'You may reprioritize orders and adjust capacity',
      'Material shortages must be resolved proactively',
    ],
    systemPrompt: 'You are in the Zero Delay challenge. Ensure zero late deliveries over 48 simulated hours. Monitor at-risk orders, manage priorities, and resolve bottlenecks.',
    tools: ['factory_get_orders_at_risk', 'factory_get_customer_otd', 'factory_check_material_readiness', 'factory_get_va05_summary'],
  },
  {
    id: 'lean-inventory',
    name: 'Lean Inventory',
    description: 'Reduce inventory holding costs by 20% without causing any material stockouts.',
    kpiGoal: 'Inventory cost -20%, 0 stockouts',
    timeLimit: '2 hours',
    difficulty: 'Intermediate',
    icon: '📦',
    rules: [
      'Reduce total inventory value by at least 20%',
      'Zero stockouts allowed during the period',
      'All work orders must continue without material delays',
      'You may adjust reorder points and purchase orders',
    ],
    systemPrompt: 'You are in the Lean Inventory challenge. Reduce inventory costs by 20% while preventing any stockouts. Optimize stock levels and purchase timing.',
    tools: ['factory_get_low_stock_items', 'factory_get_stock_item', 'factory_get_pending_purchases', 'factory_get_md04_overview'],
  },
  {
    id: 'quality-first',
    name: 'Quality First',
    description: 'Achieve Cpk > 1.33 on all quality characteristics and resolve all SPC alarms.',
    kpiGoal: 'Cpk > 1.33 all chars, 0 SPC alarms',
    timeLimit: '1 hour',
    difficulty: 'Advanced',
    icon: '🔬',
    rules: [
      'All measured characteristics must have Cpk > 1.33',
      'No active SPC alarms at challenge end',
      'All calibrations must be current',
      'Quality notifications must be addressed',
    ],
    systemPrompt: 'You are in the Quality First challenge. Achieve Cpk > 1.33 on all characteristics and resolve all SPC alarms. Monitor quality data and take corrective actions.',
    tools: ['factory_get_spc_alarms', 'factory_get_cpk_overview', 'factory_get_calibration_due', 'factory_get_quality_notifications'],
  },
  {
    id: 'energy-saver',
    name: 'Energy Saver',
    description: 'Reduce energy consumption per part by 15% over a 24-hour simulated period.',
    kpiGoal: 'kWh/part -15% over 24h',
    timeLimit: '1 hour',
    difficulty: 'Beginner',
    icon: '🌱',
    rules: [
      'Average kWh per part must decrease by 15%',
      'Production output must remain stable (±5%)',
      'Measured over 24 simulated hours',
      'Machine idle time counts against you',
    ],
    systemPrompt: 'You are in the Energy Saver challenge. Reduce kWh per part by 15% while maintaining production output. Optimize machine utilization and energy patterns.',
    tools: ['factory_get_energy_overview', 'factory_get_energy_per_part', 'factory_get_base_load', 'factory_get_energy_per_machine'],
  },
  {
    id: 'full-auto',
    name: 'Full Auto',
    description: 'Keep the factory running autonomously for 72 simulated hours with no manual intervention.',
    kpiGoal: '72h autonomous, all KPIs green',
    timeLimit: '4 hours',
    difficulty: 'Expert',
    icon: '🤖',
    rules: [
      'Factory must run 72 simulated hours without manual intervention',
      'OEE must stay above 75%',
      'No stockouts or late deliveries',
      'All agent decisions are logged for review',
    ],
    systemPrompt: 'You are in the Full Auto challenge. Design and configure an autonomous agent strategy that keeps the factory running for 72 hours. Set up monitoring, decision rules, and contingency plans.',
    tools: [
      'factory_get_latest_oee', 'factory_get_capacity_overview', 'factory_get_orders_at_risk',
      'factory_get_low_stock_items', 'factory_get_spc_alarms', 'factory_get_energy_overview',
      'factory_get_kpi_dashboard',
    ],
  },
];

const router = Router();

// GET /challenges — list all challenges
router.get('/', (_req, res: Response) => {
  const list = challenges.map(({ systemPrompt, tools, ...rest }) => rest);
  res.json({ challenges: list });
});

// GET /challenges/my-progress — Overall progress (requires auth)
router.get('/my-progress', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const result = await pool.query(
    `SELECT challenge_id, MAX(score) as best_score,
            MAX(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
     FROM challenge_attempts
     WHERE user_id = $1
     GROUP BY challenge_id`,
    [userId]
  );
  const progress = Object.fromEntries(
    result.rows.map(r => [r.challenge_id, { bestScore: r.best_score, completed: r.completed === 1 }])
  );
  res.json({
    progress,
    totalChallenges: challenges.length,
    completedCount: result.rows.filter(r => r.completed === 1).length,
  });
});

// GET /challenges/leaderboard/:id — Top 10 for a challenge (public)
router.get('/leaderboard/:id', async (req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT ca.score, ca.completed_at, u.name, u.email
     FROM challenge_attempts ca
     JOIN users u ON ca.user_id = u.id
     WHERE ca.challenge_id = $1 AND ca.status = 'completed'
     ORDER BY ca.score DESC, ca.completed_at ASC
     LIMIT 10`,
    [req.params.id]
  );
  // Anonymize: show name or first part of email
  const leaderboard = result.rows.map((r, i) => ({
    rank: i + 1,
    name: r.name || r.email.split('@')[0],
    score: r.score,
    completed_at: r.completed_at,
  }));
  res.json({ leaderboard });
});

// GET /challenges/:id — challenge detail
router.get('/:id', (req, res: Response) => {
  const challenge = challenges.find((c) => c.id === req.params.id);
  if (!challenge) {
    res.status(404).json({ error: 'Challenge not found' });
    return;
  }
  res.json({ challenge });
});

// GET /challenges/:id/attempts — My attempts for a challenge (requires auth)
router.get('/:id/attempts', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const result = await pool.query(
    'SELECT id, status, score, started_at, completed_at, metadata FROM challenge_attempts WHERE user_id = $1 AND challenge_id = $2 ORDER BY started_at DESC LIMIT 20',
    [userId, req.params.id]
  );
  res.json({ attempts: result.rows });
});

// POST /challenges/:id/start — Start a new attempt (requires auth)
router.post('/:id/start', requireAuth, async (req: Request, res: Response) => {
  const challenge = challenges.find(c => c.id === req.params.id);
  if (!challenge) { res.status(404).json({ error: 'Challenge not found' }); return; }

  const userId = (req as any).user.id;

  // Check if user already has an in_progress attempt for this challenge
  const existing = await pool.query(
    'SELECT id FROM challenge_attempts WHERE user_id = $1 AND challenge_id = $2 AND status = $3',
    [userId, challenge.id, 'in_progress']
  );
  if (existing.rows.length > 0) {
    res.json({ attempt: existing.rows[0], resumed: true });
    return;
  }

  const result = await pool.query(
    'INSERT INTO challenge_attempts (user_id, challenge_id) VALUES ($1, $2) RETURNING *',
    [userId, challenge.id]
  );
  res.status(201).json({ attempt: result.rows[0] });
});

// POST /challenges/:id/submit — Submit result (requires auth)
router.post('/:id/submit', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { score, metadata } = req.body;

  if (typeof score !== 'number' || score < 0 || score > 100) {
    res.status(400).json({ error: 'Score must be a number between 0 and 100' });
    return;
  }

  // Find the latest in_progress attempt
  const attempt = await pool.query(
    'SELECT id FROM challenge_attempts WHERE user_id = $1 AND challenge_id = $2 AND status = $3 ORDER BY started_at DESC LIMIT 1',
    [userId, req.params.id, 'in_progress']
  );
  if (attempt.rows.length === 0) {
    res.status(404).json({ error: 'No active attempt found. Start a challenge first.' });
    return;
  }

  const status = score >= 70 ? 'completed' : 'failed';
  const result = await pool.query(
    'UPDATE challenge_attempts SET status = $1, score = $2, metadata = $3, completed_at = NOW() WHERE id = $4 RETURNING *',
    [status, score, metadata || {}, attempt.rows[0].id]
  );
  res.json({ attempt: result.rows[0] });
});

export default router;
