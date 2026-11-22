import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import type { SessionUser } from '../src/types/erp.ts';
import { store } from './store.ts';

export interface AuthedRequest extends Request {
  user?: SessionUser;
  token?: string;
}

export function extractToken(req: Request): string | null {
  const authHeader = req.header('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const t = authHeader.slice(7).trim();
    if (t) return t;
  }
  const customHeader = req.header('x-depotpro-token');
  if (customHeader && customHeader.trim()) {
    return customHeader.trim();
  }
  const cookieHeader = req.header('cookie');
  if (cookieHeader) {
    const parts = cookieHeader.split(';');
    for (const part of parts) {
      const [k, ...rest] = part.trim().split('=');
      if (k === 'depotpro_session') {
        const val = rest.join('=').trim();
        if (val) return decodeURIComponent(val);
      }
    }
  }
  return null;
}

export function issueSession(user: SessionUser): string {
  const token = crypto.randomBytes(24).toString('hex');
  store.sessions.set(token, {
    user,
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
  });
  return token;
}

export function validateSession(token: string | null): SessionUser | null {
  if (!token) return null;
  const entry = store.sessions.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.sessions.delete(token);
    return null;
  }
  entry.expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  return entry.user;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  const user = validateSession(token);
  if (!user) {
    res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'Session expirée ou non authentifiée. Veuillez saisir votre code PIN.',
    });
    return;
  }
  req.user = user;
  req.token = token ?? undefined;
  next();
}

export function requirePerm(permission: string) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const token = extractToken(req);
    const user = validateSession(token);
    if (!user) {
      res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Session expirée ou non authentifiée.',
      });
      return;
    }
    if (!user.permissions.includes(permission)) {
      res.status(403).json({
        code: 'FORBIDDEN',
        message: `Permission insuffisante (${permission}).`,
      });
      return;
    }
    req.user = user;
    req.token = token ?? undefined;
    next();
  };
}
