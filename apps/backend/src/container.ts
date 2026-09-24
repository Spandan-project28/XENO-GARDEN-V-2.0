import type { Env } from './config/env.js';
import { isDbConnected } from './db/connect.js';
import type { Deps, RuntimeStatus } from './deps.js';
import { AppBus } from './lib/bus.js';
import { createAccessTokens } from './lib/crypto.js';
import { createLogger, type AppLogger } from './lib/logger.js';
import { createAlertEngine } from './modules/alerts/engine.js';
import { createAlertService } from './modules/alerts/service.js';
import { createAuthService } from './modules/auth/service.js';
import { PublisherProxy } from './modules/control/publisher.js';
import { createControlService } from './modules/control/service.js';
import { createDeviceService } from './modules/devices/service.js';
import { ExpoPushSender, NoopPushSender, type PushSender } from './modules/notifications/sender.js';
import { createNotificationService } from './modules/notifications/service.js';
import { MlHealthProvider } from './modules/insights/ml.js';
import { ProviderRegistry, type PlantHealthProvider } from './modules/insights/provider.js';
import { RuleBasedHealthProvider } from './modules/insights/rules.js';
import { createInsightsService } from './modules/insights/service.js';
import { createPlantService } from './modules/plants/service.js';
import { LocalDiskStorage } from './modules/media/storage.js';
import { createHash } from 'node:crypto';
import { createTelemetryIngest } from './modules/telemetry/ingest.js';
import { createPumpEventService } from './modules/telemetry/pumpEvents.js';
import { createReadingQueries } from './modules/telemetry/queries.js';

export interface ContainerOptions {
  now?: () => Date;
  log?: AppLogger;
  onBusError?: (err: unknown, event: string) => void;
  pushSender?: PushSender;
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
  const readings = createReadingQueries();
  const pumpEvents = createPumpEventService();
  const alerts = createAlertService({ bus });
  const alertEngine = createAlertEngine({
    bus,
    alerts,
    lowMoistureMinutes: env.ALERT_LOW_MOISTURE_MINUTES,
  });
  const sender =
    opts.pushSender ??
    (env.PUSH_ENABLED && env.NODE_ENV !== 'test' ? new ExpoPushSender(env.EXPO_ACCESS_TOKEN) : new NoopPushSender());
  const notifications = createNotificationService({ bus, sender, now, log });
  const media = new LocalDiskStorage(
    env.UPLOAD_DIR,
    createHash('sha256').update(`${env.JWT_ACCESS_SECRET}:media`).digest('hex'),
    now,
  );
  const plants = createPlantService({ storage: media });
  const providers: PlantHealthProvider[] = [new RuleBasedHealthProvider()];
  if (env.ML_SERVICE_URL) {
    providers.unshift(
      new MlHealthProvider({ url: env.ML_SERVICE_URL, apiKey: env.ML_API_KEY, modelName: env.ML_MODEL_NAME }),
    );
  }
  const registry = new ProviderRegistry(providers);
  const insights = createInsightsService({ registry, readings, pumpEvents, alerts, now, log });

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
    media,
    services: { auth, devices, control, ingest, readings, pumpEvents, alerts, alertEngine, notifications, plants, insights },
    runtime,
    status: {
      db: isDbConnected,
      mqtt: () => runtime.mqttConnected(),
      devicesConnected: () => runtime.devicesConnected(),
    },
  };
}
