/**
 * Embedded MQTT broker (aedes) used when MQTT_EMBEDDED=true: local development, tests, and
 * single-host deployments. Devices log in with username = hardwareId and the password issued at
 * claim time. The backend's own client uses a random service credential created at boot.
 *
 * With an external broker (EMQX/HiveMQ/Mosquitto) the same rules live in that broker's ACL
 * (see infra/mosquitto/acl).
 */
import { createServer, type Server } from 'node:net';
import { Aedes, type AuthenticateError, type Client } from 'aedes';
import { MQTT_ROOT } from '@xeno/shared';
import { randomToken } from '../lib/crypto.js';

type Role = { role: 'service' } | { role: 'device'; hardwareId: string };
const roles = new WeakMap<Client, Role>();

/** Leaf topics a device may publish to / subscribe to under its own subtree. */
const DEVICE_PUBLISH = new Set(['telemetry', 'reported', 'status', 'event', 'cmd/ack']);
const DEVICE_SUBSCRIBE = new Set(['desired', 'cmd']);

function deviceLeaf(topic: string, hardwareId: string): string | null {
  const prefix = `${MQTT_ROOT}/${hardwareId}/`;
  return topic.startsWith(prefix) ? topic.slice(prefix.length) : null;
}

export interface EmbeddedBroker {
  port: number;
  serviceCredentials: { username: string; password: string };
  connectedDevices: () => number;
  disconnectDevice: (hardwareId: string) => void;
  close: () => Promise<void>;
}

export interface EmbeddedBrokerOptions {
  port: number;
  host?: string;
  verifyDevice: (hardwareId: string, password: string) => Promise<boolean>;
  onDeviceConnection?: (hardwareId: string, connected: boolean) => void;
  log?: { warn: (obj: object, msg: string) => void };
}

export async function startEmbeddedBroker(opts: EmbeddedBrokerOptions): Promise<EmbeddedBroker> {
  const service = { username: 'xg-backend', password: randomToken(24) };
  const aedes = await Aedes.createBroker({ drainTimeout: 30_000, maxClientsIdLength: 64 });
  const devices = new Map<string, Client>();

  const fail = (code: 4 | 5, message: string): AuthenticateError =>
    Object.assign(new Error(message), { returnCode: code }) as AuthenticateError;

  aedes.authenticate = (client, username, password, done) => {
    const pw = password?.toString() ?? '';
    if (username === service.username) {
      if (pw === service.password) {
        roles.set(client, { role: 'service' });
        return done(null, true);
      }
      return done(fail(4, 'bad credentials'), false);
    }
    if (!username || client.id !== username) {
      return done(fail(4, 'client id must equal username'), false);
    }
    opts
      .verifyDevice(username, pw)
      .then((ok) => {
        if (!ok) return done(fail(4, 'bad credentials'), false);
        roles.set(client, { role: 'device', hardwareId: username });
        done(null, true);
      })
      .catch(() => done(fail(5, 'auth error'), false));
  };

  aedes.authorizePublish = (client, packet, done) => {
    if (packet.topic.startsWith('$SYS')) return done(new Error('reserved topic'));
    if (!client) return done(null); // broker-originated (stale LWT)
    const role = roles.get(client);
    if (role?.role === 'service') return done(null);
    if (role?.role === 'device') {
      const leaf = deviceLeaf(packet.topic, role.hardwareId);
      if (leaf && DEVICE_PUBLISH.has(leaf)) return done(null);
    }
    opts.log?.warn({ clientId: client.id, topic: packet.topic }, 'mqtt publish denied');
    done(new Error('publish not allowed'));
  };

  aedes.authorizeSubscribe = (client, sub, done) => {
    const role = roles.get(client);
    if (role?.role === 'service') return done(null, sub);
    if (role?.role === 'device') {
      const leaf = deviceLeaf(sub.topic, role.hardwareId);
      if (leaf && DEVICE_SUBSCRIBE.has(leaf)) return done(null, sub);
    }
    opts.log?.warn({ clientId: client.id, topic: sub.topic }, 'mqtt subscribe denied');
    done(null, null); // negate silently (SUBACK 128)
  };

  aedes.on('clientReady', (client) => {
    const role = roles.get(client);
    if (role?.role !== 'device') return;
    devices.set(role.hardwareId, client);
    opts.onDeviceConnection?.(role.hardwareId, true);
  });
  aedes.on('clientDisconnect', (client) => {
    const role = roles.get(client);
    if (role?.role !== 'device') return;
    if (devices.get(role.hardwareId) === client) {
      devices.delete(role.hardwareId);
      opts.onDeviceConnection?.(role.hardwareId, false);
    }
  });

  const server: Server = createServer(aedes.handle);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host ?? '0.0.0.0', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;

  return {
    port,
    serviceCredentials: service,
    connectedDevices: () => devices.size,
    disconnectDevice: (hardwareId) => devices.get(hardwareId)?.close(),
    close: async () => {
      await new Promise<void>((resolve) => aedes.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
