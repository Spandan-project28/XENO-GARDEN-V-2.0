import { loadEnv, type Env } from '../../src/config/env.js';

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    MONGO_URI: 'mongodb://unused-in-unit-tests/xg',
    JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-123',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}
