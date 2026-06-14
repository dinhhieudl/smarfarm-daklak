// ============================================================================
// SmartFarm Cloud - Device Health Monitor (Background Service)
// ============================================================================
// Periodically checks for devices that haven't reported in and marks them offline.
// Runs every 5 minutes.
// ============================================================================

import { getStaleDevices, updateDeviceStatus } from './device';
import { publish } from './redis';
import { logger } from '../utils/logger';

let intervalHandle: NodeJS.Timeout | null = null;

const STALE_THRESHOLD_MINUTES = 30;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Start the device health monitor
 */
export function startDeviceHealthMonitor(): void {
  logger.info({ thresholdMinutes: STALE_THRESHOLD_MINUTES }, 'Starting device health monitor');

  intervalHandle = setInterval(async () => {
    try {
      const staleDevices = await getStaleDevices(STALE_THRESHOLD_MINUTES);

      if (staleDevices.length === 0) return;

      logger.info(
        { count: staleDevices.length },
        'Found stale devices, marking offline'
      );

      for (const device of staleDevices) {
        await updateDeviceStatus(device.id, 'offline');

        // Broadcast device status change
        publish('device:status', {
          type: 'device_status',
          device_id: device.id,
          garden_id: device.garden_id,
          status: 'offline',
          last_seen_at: device.last_seen_at,
          timestamp: new Date().toISOString(),
        }).catch((err) =>
          logger.error({ err, deviceId: device.id }, 'Failed to broadcast device offline status')
        );
      }
    } catch (err) {
      logger.error({ err }, 'Device health check failed');
    }
  }, CHECK_INTERVAL_MS);
}

/**
 * Stop the device health monitor
 */
export function stopDeviceHealthMonitor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('Device health monitor stopped');
  }
}
