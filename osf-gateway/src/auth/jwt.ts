import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET: string = process.env.JWT_SECRET || '';
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

export interface JwtPayload {
  userId: string;
  email: string;
  tier: string;
  role: string;
}

export interface RefreshPayload {
  userId: string;
  tokenId: string;
  type: 'refresh';
}

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function signRefreshToken(userId: string): { token: string; tokenId: string } {
  const tokenId = crypto.randomUUID();
  const token = jwt.sign(
    { userId, tokenId, type: 'refresh' } as RefreshPayload,
    JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );
  return { token, tokenId };
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as unknown as JwtPayload;
}

export function verifyRefreshToken(token: string): RefreshPayload {
  const payload = jwt.verify(token, JWT_SECRET) as unknown as RefreshPayload;
  if (payload.type !== 'refresh') {
    throw new Error('Not a refresh token');
  }
  return payload;
}

// Backwards compat — old 24h tokens still work until they expire
export const signToken = signAccessToken;
