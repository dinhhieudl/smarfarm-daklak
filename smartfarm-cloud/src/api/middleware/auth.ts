// ============================================================================
// SmartFarm Cloud - Express Middleware: Authentication & Authorization
// ============================================================================
// Supports two auth methods:
//   1. API Key: X-API-Key header (for edge agents / programmatic access)
//   2. JWT Bearer: Authorization: Bearer <token> (for user sessions)
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { validateApiKey } from '../services/auth';
import { getUserById, getUserTenantId } from '../services/phoneAuth';
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
 * - API Key: X-API-Key header → scopes from api_keys table
 * - JWT: Authorization: Bearer <token> → scopes from user role
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string;
  const authHeader = req.headers.authorization;

  // Try API key first
  if (apiKey) {
    return authenticateApiKey(req, res, next, apiKey);
  }

  // Try JWT Bearer token
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    return authenticateJwt(req, res, next, token);
  }

  res.status(401).json({
    error: 'unauthenticated',
    message: 'Vui lòng cung cấp X-API-Key hoặc Authorization: Bearer <token>',
  });
}

/**
 * Authenticate via API key
 */
function authenticateApiKey(req: Request, res: Response, next: NextFunction, apiKey: string): void {
  if (!apiKey.startsWith('sf_') || apiKey.length < 20) {
    res.status(401).json({
      error: 'invalid_api_key',
      message: 'Định dạng API key không hợp lệ',
    });
    return;
  }

  validateApiKey(apiKey)
    .then((result) => {
      if (!result.valid) {
        res.status(401).json({
          error: 'invalid_api_key',
          message: 'API key không hợp lệ, đã hết hạn, hoặc đã bị thu hồi',
        });
        return;
      }

      req.tenantId = result.tenantId;
      req.gardenId = result.gardenId;
      req.scopes = result.scopes;
      req.authMethod = 'api_key';
      next();
    })
    .catch((err) => {
      logger.error({ err }, 'API key authentication error');
      res.status(500).json({ error: 'auth_error', message: 'Lỗi xác thực' });
    });
}

/**
 * Authenticate via JWT Bearer token
 */
async function authenticateJwt(
  req: Request,
  res: Response,
  next: NextFunction,
  token: string
): Promise<void> {
  try {
    const payload = jwt.verify(token, config.jwt.secret) as JwtPayload;

    // Verify user still exists and is active
    const user = await getUserById(payload.sub);
    if (!user) {
      res.status(401).json({ error: 'user_not_found', message: 'Người dùng không tồn tại' });
      return;
    }

    // Get tenant ID
    const tenantId = payload.tenant_id || await getUserTenantId(payload.sub);

    req.userId = payload.sub;
    req.tenantId = tenantId;
    req.scopes = roleToScopes(payload.role);
    req.authMethod = 'jwt';
    next();
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

/**
 * Map user role to API scopes
 */
function roleToScopes(role: string): string[] {
  switch (role) {
    case 'admin':
      return ['ingest', 'read', 'admin'];
    case 'manager':
      return ['ingest', 'read', 'admin'];
    case 'consultant':
      return ['read'];
    case 'farmer':
      return ['ingest', 'read'];
    default:
      return ['read'];
  }
}

/**
 * Require specific scopes on the authenticated request.
 */
export function requireScope(...required: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.scopes) {
      res.status(401).json({ error: 'unauthenticated', message: 'Chưa xác thực' });
      return;
    }

    const hasAll = required.every((s) => req.scopes!.includes(s));
    if (!hasAll) {
      res.status(403).json({
        error: 'insufficient_scope',
        message: `Cần quyền: ${required.join(', ')}`,
      });
      return;
    }

    next();
  };
}

/**
 * Ensure the request's garden access matches the API key's garden restriction.
 */
export function enforceGardenAccess(req: Request, res: Response, next: NextFunction): void {
  const requestedGarden = req.params.gardenId || req.body.garden_id || req.query.garden_id as string;

  // If API key is restricted to a specific garden
  if (req.gardenId && requestedGarden && req.gardenId !== requestedGarden) {
    res.status(403).json({
      error: 'garden_access_denied',
      message: 'Không có quyền truy cập nông trại này',
    });
    return;
  }

  next();
}
