import { NodeExecutor } from './types';
import { pool } from '../../db/pool';

export const executeOsfHumanInput: NodeExecutor = async (input) => {
  const prompt = input.config.prompt || 'Please provide your input:';
  const options = input.config.options || [];

  // Insert pending input record
  await pool.query(
    `INSERT INTO flow_pending_inputs (run_id, user_id, node_id, prompt, options)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.runId, input.userId, input.config.id || 'unknown', prompt, JSON.stringify(options)]
  );

  return { output: '', paused: true };
};
