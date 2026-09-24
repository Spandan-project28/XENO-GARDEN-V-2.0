/**
 * Assembles and starts the whole backend: DB → services → MQTT (embedded broker or external) →
 * HTTP API → realtime → background jobs. Used by server.ts and by end-to-end tests.
 */
import type { AddressInfo } from 'node:net';
import { buildApp, type App } from './app.js';
import type { Env } from './config/env.js';
import { createDeps, type ContainerOptions } from './container.js';
import { connectDb, disconnectDb } from './db/connect.js';
import type { Deps } from './deps.js';
import { startEmbeddedBroker, type EmbeddedBroker } from './mqtt/broker.js';
import { DeviceGateway } from './mqtt/gateway.js';
import { attachRealtime, type Realtime } from './realtime/socket.js';

const SWEEP_EVERY_MS = 30_000;
const ROLLUP_EVERY_MS = 5 * 60_000;
const HEALTH_EVERY_MS = 6 * 3_600_000;

export interface Runtime {
  app: App;
  deps: Deps;
  gateway: DeviceGateway;
  broker: EmbeddedBroker | null;
  realtime: Realtime;
  /** Base URL of the HTTP server, e.g. http://127.0.0.1:4000 */
  url: string;
  /** MQTT port devices should use when the broker is embedded. */
  mqttPort: number | null;
  /** Runs periodic jobs immediately (tests). */
  runJobs: () => Promise<void>;
  close: () => Promise<void>;
}

export async function startRuntime(env: Env, opts: ContainerOptions & { skipDb?: boolean } = {}): Promise<Runtime> {
  const deps = createDeps(env, opts);
  const { log, services, bus } = deps;

  if (!opts.skipDb) await connectDb(env.MONGO_URI, log);

  // ── MQTT ──────────────────────────────────────────────────────────────────
  let broker: EmbeddedBroker | null = null;
  let url = env.MQTT_URL ?? '';
  let username = env.MQTT_USERNAME;
  let password = env.MQTT_PASSWORD;
  if (env.MQTT_EMBEDDED) {
    broker = await startEmbeddedBroker({
      port: env.MQTT_EMBEDDED_PORT,
      verifyDevice: services.devices.verifyMqttCredentials,
      log,
    });
    url = `mqtt://127.0.0.1:${broker.port}`;
    ({ username, password } = broker.serviceCredentials);
    log.info({ port: broker.port }, 'embedded MQTT broker listening');
  }

  const gateway = new DeviceGateway({
    url,
    username,
    password,
    log,
    now: deps.now,
    onMessage: (kind, accepted) =>
      accepted ? deps.metrics.mqttMessages.inc({ kind }) : deps.metrics.mqttDropped.inc({ kind }),
  });
  gateway.setHandlers({
    telemetry: (hw, p, at) => services.ingest.telemetry(hw, p, at),
    reported: async (hw, p, at) => {
      const deviceId = await services.control.onReported(hw, p, at);
      if (deviceId) await services.pumpEvents.onReported(deviceId, p.pump, p.pumpReason, at);
    },
    status: (hw, online, at) => services.ingest.status(hw, online, at),
    event: (hw, p, at) => services.ingest.event(hw, p, at),
    cmdAck: (hw, p) => services.control.onCmdAck(hw, p),
  });
  gateway.onConnect(async () => {
    const n = await services.control.republishAll();
    log.info({ devices: n }, 'desired state republished');
  });
  await gateway.start();
  deps.publisher.attach(gateway);
  deps.runtime.mqttConnected = () => gateway.isConnected();
  deps.runtime.devicesConnected = () => broker?.connectedDevices() ?? 0;

  const offClaimed = bus.on('device.claimed', async (e) => {
    // New credentials: drop any session using the old password, then hand out config.
    broker?.disconnectDevice(e.hardwareId);
    await gateway.publishDesired(e.hardwareId, e.desired).catch((err) =>
      log.warn({ err, hardwareId: e.hardwareId }, 'desired publish after claim failed'),
    );
  });
  const offRemoved = bus.on('device.removed', async (e) => {
    broker?.disconnectDevice(e.hardwareId);
    await gateway.clearDesired(e.hardwareId).catch(() => {});
  });

  // ── HTTP + realtime ───────────────────────────────────────────────────────
  const app = await buildApp(deps);
  await app.listen({ port: env.PORT, host: env.HOST });
  const realtime = attachRealtime(app.server, deps);
  const addr = app.server.address() as AddressInfo;
  const host = env.HOST === '0.0.0.0' ? '127.0.0.1' : env.HOST;

  // ── background jobs ───────────────────────────────────────────────────────
  const sweep = () =>
    services.ingest.sweepStale(deps.now(), (d) =>
      Math.max(60_000, d.desired.settings.telemetryIntervalSec * env.OFFLINE_AFTER_INTERVALS * 1000),
    );
  const rollup = () => {
    const now = deps.now();
    return services.readings.rollup(new Date(now.getTime() - 2 * 3_600_000), now);
  };
  const guard = (name: string, job: () => Promise<unknown>) => () =>
    job().catch((err) => log.error({ err, job: name }, 'background job failed'));
  const timers = [
    setInterval(guard('sweep', sweep), SWEEP_EVERY_MS),
    setInterval(guard('rollup', rollup), ROLLUP_EVERY_MS),
    setInterval(guard('alerts', () => services.alertEngine.tick(deps.now())), SWEEP_EVERY_MS),
    setInterval(guard('plant-health', () => services.insights.runDue()), HEALTH_EVERY_MS),
  ];
  timers.forEach((t) => t.unref());

  return {
    app,
    deps,
    gateway,
    broker,
    realtime,
    url: `http://${host}:${addr.port}`,
    mqttPort: broker?.port ?? null,
    runJobs: async () => {
      await sweep();
      await rollup();
      await services.alertEngine.tick(deps.now());
    },
    close: async () => {
      timers.forEach(clearInterval);
      offRemoved();
      offClaimed();
      services.alertEngine.stop();
      services.notifications.stop();
      await realtime.close();
      await app.close().catch(() => {});
      await gateway.close();
      await broker?.close();
      bus.removeAll();
      if (!opts.skipDb) await disconnectDb();
    },
  };
}
