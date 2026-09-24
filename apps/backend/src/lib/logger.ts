import { pino, type Logger } from 'pino';
import type { Env } from '../config/env.js';

export type AppLogger = Logger;

/** One logger for HTTP, MQTT and background jobs. Pretty output in development only. */
export function createLogger(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): AppLogger {
  if (env.NODE_ENV === 'test') return pino({ level: 'silent' });
  return pino({
    level: env.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.body.password', 'req.body.refreshToken', 'password'],
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
      : {}),
  });
}
