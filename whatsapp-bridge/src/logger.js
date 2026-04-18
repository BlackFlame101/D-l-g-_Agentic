/**
 * Logger module with structured logging
 */

import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    }
  }
});

export function createSessionLogger(userId) {
  return logger.child({ userId, component: 'session' });
}
