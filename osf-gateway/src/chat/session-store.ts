import { pool } from '../db/pool';

export interface StoredMessage {
  id: string;
  role: string;
  content: string | null;
  tool_calls: any;
  created_at: string;
}

export async function createSession(userId: string, title?: string): Promise<string> {
  const result = await pool.query(
    'INSERT INTO chat_sessions (user_id, title) VALUES ($1, $2) RETURNING id',
    [userId, title || 'New Chat']
  );
  return result.rows[0].id;
}

export async function getUserSessions(userId: string): Promise<any[]> {
  const result = await pool.query(
    `SELECT id, title, created_at FROM chat_sessions
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [userId]
  );
  return result.rows;
}

/** Verify session belongs to user before accessing */
export async function verifySessionOwnership(sessionId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2',
    [sessionId, userId]
  );
  return result.rows.length > 0;
}

export async function getSessionMessages(
  sessionId: string,
  userId: string,
  limit = 50
): Promise<StoredMessage[]> {
  // Join with chat_sessions to enforce ownership
  const result = await pool.query(
    `SELECT m.id, m.role, m.content, m.tool_calls, m.created_at
     FROM chat_messages m
     JOIN chat_sessions s ON s.id = m.session_id
     WHERE m.session_id = $1 AND s.user_id = $2
     ORDER BY m.created_at ASC LIMIT $3`,
    [sessionId, userId, limit]
  );
  return result.rows;
}

export async function saveMessage(
  sessionId: string,
  role: string,
  content: string | null,
  toolCalls?: any
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO chat_messages (session_id, role, content, tool_calls)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [sessionId, role, content, toolCalls ? JSON.stringify(toolCalls) : null]
  );
  return result.rows[0].id;
}

export async function updateSessionTitle(sessionId: string, userId: string, title: string): Promise<void> {
  await pool.query('UPDATE chat_sessions SET title = $1 WHERE id = $2 AND user_id = $3', [title, sessionId, userId]);
}

export async function deleteSession(sessionId: string, userId: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2', [sessionId, userId]);
  return (result.rowCount ?? 0) > 0;
}
