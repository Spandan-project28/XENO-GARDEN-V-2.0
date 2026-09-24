import type { Env } from './config/env.js';
import type { AppBus } from './lib/bus.js';
import type { AccessTokens } from './lib/crypto.js';
import type { AppLogger } from './lib/logger.js';
import type { AlertEngine } from './modules/alerts/engine.js';
import type { AlertService } from './modules/alerts/service.js';
import type { AuthService } from './modules/auth/service.js';
import type { ControlService } from './modules/control/service.js';
import type { PublisherProxy } from './modules/control/publisher.js';
import type { DeviceService } from './modules/devices/service.js';
import type { TelemetryIngest } from './modules/telemetry/ingest.js';
import type { PumpEventService } from './modules/telemetry/pumpEvents.js';
import type { ReadingQueries } from './modules/telemetry/queries.js';

export interface Services {
  auth: AuthService;
  devices: DeviceService;
  control: ControlService;
  ingest: TelemetryIngest;
  readings: ReadingQueries;
  pumpEvents: PumpEventService;
  alerts: AlertService;
  alertEngine: AlertEngine;
}

/** Mutable runtime status, filled in by the runtime once MQTT is up. */
export interface RuntimeStatus {
  mqttConnected: () => boolean;
  devicesConnected: () => number;
}

/**
 * Everything route handlers and services need, injected once at startup (see container.ts).
 * Tests build Deps through the same container with test overrides.
 */
export interface Deps {
  env: Env;
  log: AppLogger;
  bus: AppBus;
  now: () => Date;
  tokens: AccessTokens;
  publisher: PublisherProxy;
  services: Services;
  runtime: RuntimeStatus;
  status: {
    db: () => boolean;
    mqtt: () => boolean;
    devicesConnected: () => number;
  };
}
