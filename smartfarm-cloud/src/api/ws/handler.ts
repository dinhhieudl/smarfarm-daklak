// ============================================================================
// SmartFarm Cloud - WebSocket Server (Real-time Dashboard)
// ============================================================================
// Provides real-time sensor updates and alerts to connected dashboard clients.
// Clients authenticate via API key, then subscribe to garden/zone/sensor updates.
// ============================================================================

import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { IncomingMessage } from 'http';
import { validateApiKey } from './auth';
import { redisSub } from './redis';
import { wsSubscriptionSchema } from '../utils/validation';
import { SensorType } from '../types';
import { logger } from '../utils/logger';

interface WSClient {
  ws: WebSocket;
  tenantId: string;
  gardenId?: string;       // null = all gardens for tenant
  subscriptions: Set<string>;  // "garden:zone:sensorType" patterns
  authenticated: boolean;
}

const clients = new Map<WebSocket, WSClient>();

/**
 * Initialize WebSocket server
 */
export function initWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 64 * 1024, // 64KB max message
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    logger.info({ ip: req.socket.remoteAddress }, 'WebSocket connection attempt');

    const client: WSClient = {
      ws,
      tenantId: '',
      subscriptions: new Set(),
      authenticated: false,
    };
    clients.set(ws, client);

    // Authentication timeout: 10 seconds to authenticate
    const authTimeout = setTimeout(() => {
      if (!client.authenticated) {
        ws.send(JSON.stringify({ type: 'error', message: 'Authentication timeout' }));
        ws.close(4001, 'Authentication timeout');
      }
    }, 10000);

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());

        // First message must be auth
        if (!client.authenticated) {
          if (message.type !== 'auth' || !message.api_key) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'First message must be { type: "auth", api_key: "sf_..." }',
            }));
            return;
          }

          const authResult = await validateApiKey(message.api_key);
          if (!authResult.valid) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid API key' }));
            ws.close(4003, 'Invalid API key');
            return;
          }

          if (!authResult.scopes?.includes('read')) {
            ws.send(JSON.stringify({ type: 'error', message: 'API key missing read scope' }));
            ws.close(4003, 'Insufficient permissions');
            return;
          }

          clearTimeout(authTimeout);
          client.authenticated = true;
          client.tenantId = authResult.tenantId!;
          client.gardenId = authResult.gardenId;

          ws.send(JSON.stringify({
            type: 'authenticated',
            tenant_id: client.tenantId,
            garden_id: client.gardenId,
          }));

          logger.info({ tenantId: client.tenantId }, 'WebSocket client authenticated');
          return;
        }

        // Handle subscription messages
        const subParse = wsSubscriptionSchema.safeParse(message);
        if (subParse.success) {
          const sub = subParse.data;

          if (sub.type === 'subscribe') {
            const pattern = `${sub.garden_id || '*'}:${sub.zone_id || '*'}:${sub.sensor_types?.join(',') || '*'}`;
            if (sub.garden_id && client.gardenId && sub.garden_id !== client.gardenId) {
              ws.send(JSON.stringify({ type: 'error', message: 'Garden access denied' }));
              return;
            }
            client.subscriptions.add(pattern);
            ws.send(JSON.stringify({ type: 'subscribed', pattern }));
            logger.debug({ tenantId: client.tenantId, pattern }, 'Client subscribed');
          } else {
            const pattern = `${sub.garden_id || '*'}:${sub.zone_id || '*'}:${sub.sensor_types?.join(',') || '*'}`;
            client.subscriptions.delete(pattern);
            ws.send(JSON.stringify({ type: 'unsubscribed', pattern }));
          }
          return;
        }

        ws.send(JSON.stringify({ type: 'error', message: 'Unknown message format' }));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      clients.delete(ws);
      logger.debug('WebSocket client disconnected');
    });

    ws.on('error', (err) => {
      logger.error({ err }, 'WebSocket error');
      clients.delete(ws);
    });

    // Send ping every 30 seconds to detect dead connections
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);

    ws.on('close', () => clearInterval(pingInterval));
  });

  // Subscribe to Redis pub/sub for sensor updates and alerts
  setupRedisSubscriptions();

  logger.info('WebSocket server initialized on /ws');
  return wss;
}

/**
 * Subscribe to Redis channels and broadcast to matching WebSocket clients
 */
function setupRedisSubscriptions(): void {
  // We need a separate subscriber instance since ioredis pub/sub is blocking
  const sub = redisSub;

  sub.subscribe('sensor:updates', 'alerts', (err) => {
    if (err) {
      logger.error({ err }, 'Failed to subscribe to Redis channels');
      return;
    }
    logger.info('Subscribed to Redis channels: sensor:updates, alerts');
  });

  sub.on('message', (channel, message) => {
    try {
      const data = JSON.parse(message);
      broadcastToClients(channel, data);
    } catch (err) {
      logger.error({ err, channel }, 'Failed to parse Redis message for WS broadcast');
    }
  });
}

/**
 * Broadcast a message to all authenticated clients whose subscriptions match
 */
function broadcastToClients(channel: string, data: any): void {
  const messageType = channel === 'alerts' ? 'alert' : 'sensor_update';

  for (const [ws, client] of clients) {
    if (!client.authenticated || ws.readyState !== WebSocket.OPEN) continue;

    // Check tenant match
    if (messageType === 'alert' && data.payload?.tenant_id !== client.tenantId) continue;
    if (messageType === 'sensor_update' && data.garden_id) {
      // If client has a garden restriction, only send matching data
      if (client.gardenId && data.garden_id !== client.gardenId) continue;
    }

    // Check subscription patterns
    if (client.subscriptions.size > 0) {
      let matches = false;
      for (const pattern of client.subscriptions) {
        if (matchesPattern(pattern, data)) {
          matches = true;
          break;
        }
      }
      if (!matches) continue;
    }

    // Send
    const message: { type: string; payload: unknown; timestamp: string } = {
      type: messageType,
      payload: data,
      timestamp: new Date().toISOString(),
    };

    try {
      ws.send(JSON.stringify(message));
    } catch (err) {
      logger.debug({ err }, 'Failed to send to WebSocket client');
    }
  }
}

/**
 * Check if a data message matches a subscription pattern
 * Pattern format: "garden:zone:sensor_types"
 * Wildcard: '*' matches anything
 */
function matchesPattern(pattern: string, data: any): boolean {
  const [gardenPattern, zonePattern, sensorPattern] = pattern.split(':');

  // Garden match
  if (gardenPattern !== '*' && data.garden_id !== gardenPattern) return false;

  // Zone match
  if (zonePattern !== '*' && data.zone_id !== zonePattern) return false;

  // Sensor type match
  if (sensorPattern !== '*') {
    const allowedTypes = new Set(sensorPattern.split(','));
    if (data.readings) {
      const hasMatch = data.readings.some((r: any) => allowedTypes.has(r.sensor_type));
      if (!hasMatch) return false;
    } else if (data.sensor_type && !allowedTypes.has(data.sensor_type)) {
      return false;
    }
  }

  return true;
}

/**
 * Get connected client count (for health check)
 */
export function getWSClientCount(): number {
  return clients.size;
}
