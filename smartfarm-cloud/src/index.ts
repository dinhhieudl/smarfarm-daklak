// ============================================================================
// SmartFarm Cloud - Application Entry Point (Updated)
// ============================================================================

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createServer } from 'http';
import { config } from './config';
import { logger } from './utils/logger';
import { pool, healthCheck } from './db/pool';
import { closeRedis } from './services/redis';
import { startMqttIngest, stopMqttIngest } from './services/mqtt';
import { initWebSocket } from './api/ws/handler';
import { startDeviceHealthMonitor, stopDeviceHealthMonitor } from './services/healthMonitor';

// Route imports
import authRoutes from './api/routes/auth';
import tenantRoutes from './api/routes/tenants';
import deviceRoutes from './api/routes/devices';
import sensorRoutes from './api/routes/sensors';
import analyticsRoutes from './api/routes/analytics';
import alertRoutes from './api/routes/alerts';
import apiKeyRoutes from './api/routes/apikeys';
import cooperativeRoutes from './api/routes/cooperatives';
import inputRoutes from './api/routes/inputs';

async function main() {
  logger.info({ env: config.env }, 'Starting SmartFarm Cloud Backend');

  // ---- Express App ----
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization'],
    maxAge: 86400,
  }));
  app.use(express.json({ limit: '5mb' }));

  // Health check (unauthenticated)
  app.get('/health', async (_req, res) => {
    const dbOk = await healthCheck();
    const status = dbOk ? 200 : 503;
    res.status(status).json({
      status: dbOk ? 'healthy' : 'degraded',
      version: '2.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks: {
        database: dbOk ? 'ok' : 'failed',
      },
    });
  });

  // API Routes
  const apiV1 = '/api/v1';

  // Auth (phone OTP + JWT)
  app.use(`${apiV1}/auth`, authRoutes);

  // Core CRUD
  app.use(`${apiV1}/tenants`, tenantRoutes);
  app.use(`${apiV1}/gardens`, tenantRoutes);
  app.use(`${apiV1}/devices`, deviceRoutes);

  // Sensor data (ingest + query)
  app.use(`${apiV1}/sensors`, sensorRoutes);

  // Analytics
  app.use(`${apiV1}/analytics`, analyticsRoutes);

  // Alerts
  app.use(`${apiV1}/alerts`, alertRoutes);

  // API Keys (for edge agents)
  app.use(`${apiV1}/apikeys`, apiKeyRoutes);

  // Cooperatives (multi-farm management)
  app.use(`${apiV1}/cooperatives`, cooperativeRoutes);

  // Crop Seasons & Farm Inputs
  app.use(`${apiV1}`, inputRoutes);

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'Endpoint không tồn tại' });
  });

  // Global error handler
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err: err.message, stack: err.stack }, 'Unhandled error');
    res.status(500).json({
      error: 'internal_error',
      message: config.env === 'development' ? err.message : 'Lỗi hệ thống',
    });
  });

  // ---- HTTP Server ----
  const server = createServer(app);

  // ---- WebSocket Server ----
  initWebSocket(server);

  // ---- MQTT Ingest ----
  startMqttIngest();

  // ---- Background Services ----
  startDeviceHealthMonitor();

  // ---- Start Server ----
  server.listen(config.port, () => {
    logger.info({ port: config.port }, `SmartFarm Cloud Backend listening on port ${config.port}`);
    logger.info(`  REST API:    http://localhost:${config.port}/api/v1`);
    logger.info(`  WebSocket:   ws://localhost:${config.port}/ws`);
    logger.info(`  Health:      http://localhost:${config.port}/health`);
    logger.info(`  Auth:        POST ${apiV1}/auth/send-otp`);
    logger.info(`  MQTT topics: smartfarm/{farm_id}/telemetry/#`);
  });

  // ---- Graceful Shutdown ----
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received, cleaning up...');

    stopDeviceHealthMonitor();
    await stopMqttIngest();
    await closeRedis();

    server.close(() => {
      logger.info('HTTP server closed');
      pool.end().then(() => {
        logger.info('Database pool closed');
        process.exit(0);
      });
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start application');
  process.exit(1);
});
