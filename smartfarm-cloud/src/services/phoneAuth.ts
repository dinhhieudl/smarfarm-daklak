// ============================================================================
// SmartFarm Cloud - Phone OTP Authentication Service
// ============================================================================
// Vietnamese farmers authenticate via phone number + OTP (SMS).
// Supports: Twilio, eSMS (Vietnam), VietGuys, or console (development).
// ============================================================================

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../db/pool';
import { config } from '../config';
import { cacheGet, cacheSet, cacheDelete } from './redis';
import { User, OtpSession, AuthTokens, JwtPayload } from '../types';
import { logger } from '../utils/logger';

const BCRYPT_ROUNDS = 10;

// ============================================================================
// OTP Generation & Sending
// ============================================================================

function generateOtp(length: number): string {
  const digits = '0123456789';
  let otp = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    otp += digits[bytes[i] % 10];
  }
  return otp;
}

/**
 * Send OTP via SMS provider
 */
async function sendSms(phone: string, otp: string): Promise<boolean> {
  const message = `SmartFarm Ma xac thuan: ${otp}. Co hieu luc trong 5 phut.`;

  switch (config.otp.smsProvider) {
    case 'console':
      logger.info({ phone, otp }, '[DEV] OTP SMS (console mode)');
      return true;

    case 'esms': {
      // eSMS.vn - popular Vietnamese SMS provider
      try {
        const resp = await fetch('https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ApiKey: config.otp.esmsApiKey,
            SecretKey: config.otp.esmsSecret,
            Brandname: 'SmartFarm',
            SmsType: '2',
            IsUnicode: '0',
            phone,
            message,
          }),
        });
        const data = await resp.json() as any;
        return data.CodeResult === '100';
      } catch (err) {
        logger.error({ err, phone }, 'eSMS send failed');
        return false;
      }
    }

    case 'twilio': {
      try {
        const { Twilio } = await import('twilio');
        const client = new Twilio(config.otp.twilioSid, config.otp.twilioToken);
        await client.messages.create({
          body: message,
          from: config.otp.twilioFrom,
          to: phone,
        });
        return true;
      } catch (err) {
        logger.error({ err, phone }, 'Twilio send failed');
        return false;
      }
    }

    default:
      logger.error({ provider: config.otp.smsProvider }, 'Unknown SMS provider');
      return false;
  }
}

/**
 * Request an OTP for a phone number.
 * Rate-limited: max 3 OTPs per 5 minutes per phone.
 */
export async function requestOtp(phone: string): Promise<{
  success: boolean;
  message: string;
  retry_after_seconds?: number;
}> {
  // Normalize phone: ensure +84 prefix
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return { success: false, message: 'Số điện thoại không hợp lệ' };
  }

  // Rate limit check
  const rateLimitKey = `otp:${normalizedPhone}`;
  const recentOtps = await cacheGet<number>(rateLimitKey) || 0;
  if (recentOtps >= config.otp.rateLimitMax) {
    return {
      success: false,
      message: 'Bạn đã yêu cầu quá nhiều mã OTP. Vui lòng thử lại sau.',
      retry_after_seconds: Math.ceil(config.otp.rateLimit.windowMs / 1000),
    };
  }

  // Generate OTP
  const otp = generateOtp(config.otp.length);
  const otpHash = await bcrypt.hash(otp, BCRYPT_ROUNDS);
  const expiresAt = new Date(Date.now() + config.otp.expiryMinutes * 60 * 1000);

  // Store OTP session in DB
  await withTransaction(async (client) => {
    // Invalidate any previous unused OTPs for this phone
    await client.query(
      'UPDATE otp_sessions SET used = true WHERE phone = $1 AND used = false',
      [normalizedPhone]
    );

    // Create new OTP session
    await client.query(
      `INSERT INTO otp_sessions (phone, otp_hash, expires_at, max_attempts)
       VALUES ($1, $2, $3, $4)`,
      [normalizedPhone, otpHash, expiresAt, config.otp.maxAttempts]
    );
  });

  // Send SMS
  const sent = await sendSms(normalizedPhone, otp);
  if (!sent) {
    return { success: false, message: 'Không thể gửi SMS. Vui lòng thử lại.' };
  }

  // Update rate limit
  await cacheSet(rateLimitKey, recentOtps + 1, Math.ceil(config.otp.rateLimit.windowMs / 1000));

  logger.info({ phone: normalizedPhone }, 'OTP sent');
  return { success: true, message: 'Mã OTP đã được gửi đến số điện thoại của bạn' };
}

/**
 * Verify OTP and authenticate/register user.
 * Returns JWT tokens on success.
 */
export async function verifyOtp(
  phone: string,
  otp: string,
  name?: string
): Promise<{ success: boolean; tokens?: AuthTokens; error?: string }> {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return { success: false, error: 'Số điện thoại không hợp lệ' };
  }

  // Find valid OTP session
  const sessionResult = await query<OtpSession>(
    `SELECT * FROM otp_sessions
     WHERE phone = $1 AND used = false AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [normalizedPhone]
  );

  if (sessionResult.rows.length === 0) {
    return { success: false, error: 'Mã OTP không tồn tại hoặc đã hết hạn' };
  }

  const session = sessionResult.rows[0];

  // Check attempts
  if (session.attempts >= session.max_attempts) {
    await query('UPDATE otp_sessions SET used = true WHERE id = $1', [session.id]);
    return { success: false, error: 'Đã vượt quá số lần thử. Vui lòng yêu cầu mã mới.' };
  }

  // Verify OTP
  const isValid = await bcrypt.compare(otp, session.otp_hash);
  if (!isValid) {
    await query('UPDATE otp_sessions SET attempts = attempts + 1 WHERE id = $1', [session.id]);
    return { success: false, error: 'Mã OTP không đúng' };
  }

  // Mark OTP as used
  await query('UPDATE otp_sessions SET used = true WHERE id = $1', [session.id]);

  // Find or create user
  let user = await findUserByPhone(normalizedPhone);
  if (!user) {
    // First-time user: name is required
    if (!name) {
      return { success: false, error: 'Vui lòng nhập tên của bạn (lần đăng nhập đầu tiên)' };
    }
    user = await createUser(normalizedPhone, name);
  }

  // Update last login
  await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

  // Generate tokens
  const tokens = await generateTokens(user);

  // Cache user session
  await cacheSet(`session:${user.id}`, { user, tenant_id: getTenantId(user) }, 86400);

  logger.info({ userId: user.id, phone: normalizedPhone }, 'User authenticated via OTP');
  return { success: true, tokens };
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<{ success: boolean; tokens?: AuthTokens; error?: string }> {
  try {
    const payload = jwt.verify(refreshToken, config.jwt.secret) as JwtPayload;

    const userResult = await query<User>('SELECT * FROM users WHERE id = $1 AND is_active = true', [payload.sub]);
    if (userResult.rows.length === 0) {
      return { success: false, error: 'Người dùng không tồn tại' };
    }

    const user = userResult.rows[0];
    const tokens = await generateTokens(user);
    return { success: true, tokens };
  } catch (err) {
    return { success: false, error: 'Refresh token không hợp lệ' };
  }
}

// ============================================================================
// JWT Token Generation
// ============================================================================

async function generateTokens(user: User): Promise<AuthTokens> {
  const tenantId = await getTenantId(user);

  const jwtPayload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: user.id,
    phone: user.phone,
    role: user.role,
    tenant_id: tenantId,
  };

  const accessToken = jwt.sign(jwtPayload, config.jwt.secret, {
    expiresIn: config.jwt.accessExpiry,
  });

  const refreshToken = jwt.sign({ sub: user.id, type: 'refresh' }, config.jwt.secret, {
    expiresIn: config.jwt.refreshExpiry,
  });

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 86400, // 24h in seconds
    user,
  };
}

// ============================================================================
// User Management
// ============================================================================

async function findUserByPhone(phone: string): Promise<User | null> {
  const result = await query<User>('SELECT * FROM users WHERE phone = $1', [phone]);
  return result.rows[0] || null;
}

async function createUser(phone: string, name: string): Promise<User> {
  return withTransaction(async (client) => {
    // Create user
    const userResult = await client.query<User>(
      `INSERT INTO users (id, phone, name, role, preferred_lang)
       VALUES ($1, $2, $3, 'farmer', 'vi')
       RETURNING *`,
      [uuidv4(), phone, name]
    );
    const user = userResult.rows[0];

    // Create a default tenant for the user
    const tenantResult = await client.query(
      `INSERT INTO tenants (id, name, email, plan)
       VALUES ($1, $2, $3, 'free')
       RETURNING id`,
      [uuidv4(), `${name}'s Farm`, `${phone}@smartfarm.vn`]
    );
    const tenantId = tenantResult.rows[0].id;

    // Link user to tenant
    await client.query(
      `INSERT INTO tenant_users (tenant_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [tenantId, user.id]
    );

    logger.info({ userId: user.id, tenantId, phone }, 'New user and tenant created');
    return user;
  });
}

async function getTenantId(user: User): Promise<string | undefined> {
  const cached = await cacheGet<{ tenant_id: string }>(`session:${user.id}`);
  if (cached?.tenant_id) return cached.tenant_id;

  const result = await query(
    'SELECT tenant_id FROM tenant_users WHERE user_id = $1 LIMIT 1',
    [user.id]
  );
  return result.rows[0]?.tenant_id;
}

/**
 * Get user by ID (for JWT middleware)
 */
export async function getUserById(userId: string): Promise<User | null> {
  const result = await query<User>('SELECT * FROM users WHERE id = $1 AND is_active = true', [userId]);
  return result.rows[0] || null;
}

/**
 * Get user's tenant ID
 */
export async function getUserTenantId(userId: string): Promise<string | undefined> {
  const result = await query(
    'SELECT tenant_id FROM tenant_users WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  return result.rows[0]?.tenant_id;
}

// ============================================================================
// Phone Normalization
// ============================================================================

function normalizePhone(phone: string): string | null {
  // Remove spaces, dashes, dots
  let cleaned = phone.replace(/[\s\-\.]/g, '');

  // Vietnamese phone patterns
  if (cleaned.startsWith('+84')) {
    cleaned = cleaned;
  } else if (cleaned.startsWith('84')) {
    cleaned = '+' + cleaned;
  } else if (cleaned.startsWith('0')) {
    cleaned = '+84' + cleaned.substring(1);
  } else {
    return null; // invalid format
  }

  // Validate: +84 followed by 9-10 digits
  if (!/^\+84\d{9,10}$/.test(cleaned)) {
    return null;
  }

  return cleaned;
}
