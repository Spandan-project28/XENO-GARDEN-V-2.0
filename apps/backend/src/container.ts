import type { Env } from './config/env.js';
import { isDbConnected } from './db/connect.js';
import type { Deps, RuntimeStatus } from './deps.js';
import { AppBus } from './lib/bus.js';
import { createAccessTokens } from './lib/crypto.js';
import { createLogger, type AppLogger } from './lib/logger.js';
import { createAuthService } from './modules/auth/service.js';
import { PublisherProxy } from './modules/control/publisher.js';
import { createControlService } from './modules/control/service.js';
import { createDeviceService } from './modules/devices/service.js';
import { createTelemetryIngest } from './modules/telemetry/ingest.js';

export interface ContainerOptions {
  now?: () => Date;
  log?: AppLogger;
  onBusError?: (err: unknown, event: string) => void;
}

/** Wires services together. The only place that knows how everything is constructed. */
export function createDeps(env: Env, opts: ContainerOptions = {}): Deps {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? createLogger(env);
  const bus = new AppBus(
    opts.onBusError ?? ((err, event) => log.error({ err, event }, 'bus listener failed')),
  );
  const tokens = createAccessTokens(env.JWT_ACCESS_SECRET, env.ACCESS_TOKEN_TTL_SEC);
  const publisher = new PublisherProxy();

  const auth = createAuthService({ tokens, refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS, now });
  const devices = createDeviceService({ env, bus, now });
  const control = createControlService({ devices, publisher, bus, now, log });
  const ingest = createTelemetryIngest({ bus, log });

  const runtime: RuntimeStatus = {
    mqttConnected: () => false,
    devicesConnected: () => 0,
  };

  return {
    env,
    log,
    bus,
    now,
    tokens,
    publisher,
    services: { auth, devices, control, ingest },
    runtime,
    status: {
      db: isDbConnected,
      mqtt: () => runtime.mqttConnected(),
      devicesConnected: () => runtime.devicesConnected(),
    },
  };
}
