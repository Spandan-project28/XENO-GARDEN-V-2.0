import type { Env } from './config/env.js';
import type { AppBus } from './lib/bus.js';

/**
 * Everything route handlers and services need, injected once at startup.
 * Tests build their own Deps with fakes (see test/helpers).
 */
export interface Deps {
  env: Env;
  bus: AppBus;
  now: () => Date;
  status: {
    db: () => boolean;
    mqtt: () => boolean;
    devicesConnected: () => number;
  };
}
