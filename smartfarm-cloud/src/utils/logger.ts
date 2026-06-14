// ============================================================================
// SmartFarm Cloud - Structured Logger (pino)
// ============================================================================

import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.log.level,
  transport:
    config.env === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
});
