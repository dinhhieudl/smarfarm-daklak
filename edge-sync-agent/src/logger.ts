import * as winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';
import { Config } from './config';

export function createLogger(config: Config['logging']): winston.Logger {
  const logDir = path.dirname(config.file);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const formats = [
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
  ];

  const consoleFormat = winston.format.combine(
    ...formats,
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `${timestamp} [${level}] ${message}${metaStr}`;
    })
  );

  const fileFormat = winston.format.combine(
    ...formats,
    winston.format.json()
  );

  return winston.createLogger({
    level: config.level,
    transports: [
      new winston.transports.Console({ format: consoleFormat }),
      new winston.transports.File({
        filename: config.file,
        format: fileFormat,
        maxsize: config.maxSizeMb * 1024 * 1024,
        maxFiles: config.maxFiles,
        tailable: true,
      }),
    ],
  });
}
