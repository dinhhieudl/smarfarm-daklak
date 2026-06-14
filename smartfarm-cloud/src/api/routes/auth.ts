// ============================================================================
// SmartFarm Cloud - API Routes: Phone OTP Authentication
// ============================================================================

import { Router, Request, Response } from 'express';
import { requestOtp, verifyOtp, refreshAccessToken, getUserById, getUserTenantId } from '../../services/phoneAuth';
import { authenticate } from '../middleware/auth';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { JwtPayload } from '../../types';
import { logger } from '../../utils/logger';

const router = Router();

// Validation schemas
const sendOtpSchema = z.object({
  phone: z.string().min(8).max(15),
});

const verifyOtpSchema = z.object({
  phone: z.string().min(8).max(15),
  otp: z.string().length(6).regex(/^\d+$/),
  name: z.string().min(1).max(200).optional(),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(10),
});

// POST /api/v1/auth/send-otp - Request OTP
router.post('/send-otp', async (req: Request, res: Response) => {
  try {
    const parsed = sendOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'validation_error',
        message: 'Số điện thoại không hợp lệ',
        details: parsed.error.issues,
      });
      return;
    }

    const result = await requestOtp(parsed.data.phone);

    if (result.success) {
      res.json({ success: true, message: result.message });
    } else {
      const status = result.retry_after_seconds ? 429 : 400;
      res.status(status).json({
        success: false,
        message: result.message,
        retry_after_seconds: result.retry_after_seconds,
      });
    }
  } catch (err) {
    logger.error({ err }, 'send-otp error');
    res.status(500).json({ error: 'internal_error', message: 'Lỗi hệ thống' });
  }
});

// POST /api/v1/auth/verify-otp - Verify OTP & authenticate
router.post('/verify-otp', async (req: Request, res: Response) => {
  try {
    const parsed = verifyOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'validation_error',
        message: 'Dữ liệu không hợp lệ',
        details: parsed.error.issues,
      });
      return;
    }

    const { phone, otp, name } = parsed.data;
    const result = await verifyOtp(phone, otp, name);

    if (result.success && result.tokens) {
      res.json({
        success: true,
        ...result.tokens,
      });
    } else {
      res.status(401).json({
        success: false,
        error: 'auth_failed',
        message: result.error,
      });
    }
  } catch (err) {
    logger.error({ err }, 'verify-otp error');
    res.status(500).json({ error: 'internal_error', message: 'Lỗi hệ thống' });
  }
});

// POST /api/v1/auth/refresh - Refresh access token
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', message: 'refresh_token required' });
      return;
    }

    const result = await refreshAccessToken(parsed.data.refresh_token);

    if (result.success && result.tokens) {
      res.json({ success: true, ...result.tokens });
    } else {
      res.status(401).json({ success: false, error: 'invalid_token', message: result.error });
    }
  } catch (err) {
    logger.error({ err }, 'refresh error');
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/v1/auth/me - Get current user profile
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    // authenticate middleware sets req.tenantId from API key or JWT
    const authHeader = req.headers.authorization;
    const apiKey = req.headers['x-api-key'] as string;

    let userId: string | undefined;

    // Check if JWT auth
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const payload = jwt.verify(token, config.jwt.secret) as JwtPayload;
        userId = payload.sub;
      } catch {
        res.status(401).json({ error: 'invalid_token' });
        return;
      }
    } else if (apiKey) {
      // API key auth - return tenant info
      res.json({
        auth_method: 'api_key',
        tenant_id: req.tenantId,
        garden_id: req.gardenId,
        scopes: req.scopes,
      });
      return;
    }

    if (!userId) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }

    const user = await getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'user_not_found' });
      return;
    }

    const tenantId = await getUserTenantId(userId);

    res.json({
      auth_method: 'phone_otp',
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        role: user.role,
        preferred_lang: user.preferred_lang,
        created_at: user.created_at,
      },
      tenant_id: tenantId,
    });
  } catch (err) {
    logger.error({ err }, 'get profile error');
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
