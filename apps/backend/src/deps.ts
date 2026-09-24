import type { Env } from './config/env.js';
import type { AppBus } from './lib/bus.js';
import type { AccessTokens } from './lib/crypto.js';
import type { AuthService } from './modules/auth/service.js';

export interface Services {
  auth: AuthService;
}

/**
 * Everything route handlers and services need, injected once at startup (see container.ts).
 * Tests build Deps through the same container with test overrides.
 */
export interface Deps {
  env: Env;
  bus: AppBus;
  now: () => Date;
  tokens: AccessTokens;
  services: Services;
  status: {
    db: () => boolean;
    mqtt: () => boolean;
    devicesConnected: () => number;
  };
}
