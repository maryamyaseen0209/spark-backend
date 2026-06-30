import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env.js';

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.jwtAccessSecret, { expiresIn: env.accessTokenTtl });
}

export function signRefreshToken(user, sessionId) {
  return jwt.sign({ sub: user.id, sid: sessionId }, env.jwtRefreshSecret, { expiresIn: env.refreshTokenTtl });
}

export function signResetToken(user) {
  return jwt.sign({ sub: user.id, tokenVersion: user.passwordResetVersion }, env.jwtResetSecret, { expiresIn: env.passwordResetTtl });
}

export const randomToken = () => crypto.randomBytes(32).toString('hex');
