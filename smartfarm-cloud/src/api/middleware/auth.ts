// ============================================================================
// SmartFarm Cloud - Express Middleware: Authentication & Authorization
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { validateApiKey } from '../../services/auth';
import { getUserById, getUserTenantId } from '../../services/phoneAuth';
import { config } from '../../config';
import { JwtPayload } from '../../types';
import { logger } from '../../utils/logger';

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      gardenId?: string;
      scopes?: string[];
      userId?: string;
      authMethod?: 'api_key' | 'jwt';
    }
  }
}

/**
 * Authenticate requests via API key OR JWT Bearer token.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string;
  const authHeader = req.headers.authorization;

  if (apiKey) {
    authenticateApiKey(req, res, next, apiKey);
    return;
  }

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    authenticateJwt(req, res, next, token);
    return;
  }

  res.status(401).json({
    error: 'unauthenticated',
    message: 'Vui lòng cung cấp X-API-Key hoặc Authorization: Bearer <token>',
  });
}

function authenticateApiKey(req: Request, res: Response, next: NextFunction, apiKey: string): void {
  if (!apiKey.startsWith('sf_') || apiKey.length < 20) {
    res.status(401).json({ error: 'invalid_api_key', message: 'Định dạng API key không hợp lệ' });
    return;
  }

  validateApiKey(apiKey)
    .then((result: any) => {
      if (!result.valid) {
        res.status(401).json({ error: 'invalid_api_key', message: 'API key không hợp lệ' });
        return;
      }
      req.tenantId = result.tenantId;
      req.gardenId = result.gardenId;
      req.scopes = result.scopes;
      req.authMethod = 'api_key';
      next();
    })
    .catch((err: any) => {
      logger.error({ err }, 'API key authentication error');
      res.status(500).json({ error: 'auth_error' });
    });
}

function authenticateJwt(req: Request, res: Response, next: NextFunction, token: string): void {
  try {
    const payload = jwt.verify(token, config.jwt.secret) as JwtPayload;

    getUserById(payload.sub)
      .then((user: any) => {
        if (!user) {
          res.status(401).json({ error: 'user_not_found' });
          return;
        }

        getUserTenantId(payload.sub)
          .then((tenantId: any) => {
            req.userId = payload.sub;
            req.tenantId = payload.tenant_id || tenantId;
            req.scopes = roleToScopes(payload.role);
            req.authMethod = 'jwt';
            next();
          })
          .catch(() => {
            req.userId = payload.sub;
            req.tenantId = payload.tenant_id;
            req.scopes = roleToScopes(payload.role);
            req.authMethod = 'jwt';
            next();
          });
      })
      .catch((err: any) => {
        logger.error({ err }, 'User lookup failed');
        res.status(500).json({ error: 'auth_error' });
      });
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'token_expired', message: 'Token đã hết hạn' });
      return;
    }
    if (err.name === 'JsonWebTokenError') {
      res.status(401).json({ error: 'invalid_token', message: 'Token không hợp lệ' });
      return;
    }
    logger.error({ err }, 'JWT authentication error');
    res.status(500).json({ error: 'auth_error' });
  }
}

function roleToScopes(role: string): string[] {
  switch (role) {
    case 'admin': return ['ingest', 'read', 'admin'];
    case 'manager': return ['ingest', 'read', 'admin'];
    case 'consultant': return ['read'];
    case 'farmer': return ['ingest', 'read'];
    default: return ['read'];
  }
}

export function requireScope(...required: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.scopes) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const hasAll = required.every((s) => req.scopes!.includes(s));
    if (!hasAll) {
      res.status(403).json({ error: 'insufficient_scope', message: `Cần quyền: ${required.join(', ')}` });
      return;
    }
    next();
  };
}

export function enforceGardenAccess(req: Request, res: Response, next: NextFunction): void {
  const requestedGarden = req.params.gardenId || req.body.garden_id || req.query.garden_id as string;
  if (req.gardenId && requestedGarden && req.gardenId !== requestedGarden) {
    res.status(403).json({ error: 'garden_access_denied' });
    return;
  }
  next();
}
