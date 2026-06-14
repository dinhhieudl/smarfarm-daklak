// ============================================================================
// SmartFarm Cloud - Configuration (Updated)
// ============================================================================

import dotenv from 'dotenv';
dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  db: {
    url: process.env.DATABASE_URL || 'postgresql://smartfarm:smartfarm@localhost:5432/smartfarm_cloud',
    poolSize: parseInt(process.env.DB_POOL_SIZE || '20', 10),
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'sf:',
  },

  mqtt: {
    brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
    username: process.env.MQTT_USERNAME || 'cloud_ingest',
    password: process.env.MQTT_PASSWORD || '',
    // Updated topic structure matching the data sync framework
    topicPrefix: process.env.MQTT_TOPIC_PREFIX || 'smartfarm',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me-min-32-chars!!',
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '24h',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '30d',
  },

  // Phone OTP authentication (Vietnamese farmers)
  otp: {
    length: parseInt(process.env.OTP_LENGTH || '6', 10),
    expiryMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES || '5', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10),
    // SMS provider: 'twilio', 'vietguys', 'esms', or 'console' (dev)
    smsProvider: process.env.SMS_PROVIDER || 'console',
    twilioSid: process.env.TWILIO_SID || '',
    twilioToken: process.env.TWILIO_TOKEN || '',
    twilioFrom: process.env.TWILIO_FROM || '',
    // Vietnamese SMS providers
    esmsApiKey: process.env.ESMS_API_KEY || '',
    esmsSecret: process.env.ESMS_SECRET || '',
    vietguysApiKey: process.env.VIETGUYS_API_KEY || '',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    otpWindowMs: parseInt(process.env.OTP_RATE_LIMIT_WINDOW_MS || '300000', 10), // 5 min
    otpMaxRequests: parseInt(process.env.OTP_RATE_LIMIT_MAX || '3', 10),
  },

  log: {
    level: process.env.LOG_LEVEL || 'info',
  },

  // Weather API (Open-Meteo, free, no key needed)
  weather: {
    baseUrl: 'https://api.open-meteo.com/v1',
  },
} as const;
