import type { Env } from './config/env.js';
import { isDbConnected } from './db/connect.js';
import type { Deps } from './deps.js';
import { AppBus } from './lib/bus.js';
import { createAccessTokens } from './lib/crypto.js';
import { createAuthService } from './modules/auth/service.js';
import { createDeviceService } from './modules/devices/service.js';

export interface ContainerOptions {
  now?: () => Date;
  onBusError?: (err: unknown, event: string) => void;
}

/** Wires services together. The only place that knows how everything is constructed. */
export function createDeps(env: Env, opts: ContainerOptions = {}): Deps {
  const now = opts.now ?? (() => new Date());
  const bus = new AppBus(
    opts.onBusError ??
      ((err, event) => {
        // eslint-disable-next-line no-console
        console.error(`[bus] listener for ${event} failed`, err);
      }),
  );
  const tokens = createAccessTokens(env.JWT_ACCESS_SECRET, env.ACCESS_TOKEN_TTL_SEC);

  const auth = createAuthService({ tokens, refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS, now });

  const devices = createDeviceService({ env, bus, now });

  const mqttState = { connected: false, devices: 0 };

  return {
    env,
    bus,
    now,
    tokens,
    services: { auth, devices },
    status: {
      db: isDbConnected,
      mqtt: () => mqttState.connected,
      devicesConnected: () => mqttState.devices,
    },
  };
}
