/**
 * The backend's MQTT client: subscribes to every device's uplink topics, validates payloads with
 * the shared schemas, and hands them to domain handlers. Also publishes desired state/commands.
 * Messages for one device are processed strictly in order (per-device queue).
 */
import mqtt, { type MqttClient } from 'mqtt';
import {
  commandAckPayload,
  eventPayload,
  parseTopic,
  reportedPayload,
  statusPayload,
  telemetryPayload,
  topicFor,
  wildcardFor,
  type CommandAckPayload,
  type CommandPayload,
  type DesiredState,
  type EventPayload,
  type ReportedPayload,
  type TelemetryPayload,
} from '@xeno/shared';

export interface InboundHandlers {
  telemetry: (hardwareId: string, payload: TelemetryPayload, at: Date) => Promise<void>;
  reported: (hardwareId: string, payload: ReportedPayload, at: Date) => Promise<void>;
  status: (hardwareId: string, online: boolean, at: Date) => Promise<void>;
  event: (hardwareId: string, payload: EventPayload, at: Date) => Promise<void>;
  cmdAck: (hardwareId: string, payload: CommandAckPayload, at: Date) => Promise<void>;
}

export interface GatewayLogger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface DeviceGatewayOptions {
  url: string;
  username?: string;
  password?: string;
  clientId?: string;
  log: GatewayLogger;
  now?: () => Date;
}

const SUBSCRIPTIONS = ['telemetry', 'reported', 'status', 'event', 'cmdAck'] as const;
/** Device messages are small JSON documents; anything bigger is abuse or a bug. */
export const MAX_DEVICE_MESSAGE_BYTES = 8 * 1024;

export class DeviceGateway {
  private client: MqttClient | null = null;
  private handlers: InboundHandlers | null = null;
  private connectListeners: (() => Promise<void>)[] = [];
  private readonly queues = new Map<string, Promise<void>>();
  private readonly now: () => Date;

  constructor(private readonly opts: DeviceGatewayOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  setHandlers(handlers: InboundHandlers) {
    this.handlers = handlers;
  }

  /** Runs after the first connect and after every reconnect (e.g. to republish retained state). */
  onConnect(listener: () => Promise<void>) {
    this.connectListeners.push(listener);
  }

  private fireConnect() {
    for (const l of this.connectListeners) {
      l().catch((err) => this.opts.log.error({ err }, 'mqtt onConnect listener failed'));
    }
  }

  isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  async start(): Promise<void> {
    const client = await mqtt.connectAsync(this.opts.url, {
      username: this.opts.username,
      password: this.opts.password,
      clientId: this.opts.clientId ?? `xg-backend-${process.pid}-${Date.now().toString(36)}`,
      clean: true,
      reconnectPeriod: 2000,
      connectTimeout: 10_000,
    });
    this.client = client;
    client.on('message', (topic, payload) => this.onMessage(topic, payload));
    client.on('reconnect', () => this.opts.log.warn({}, 'mqtt reconnecting'));
    client.on('error', (err) => this.opts.log.error({ err }, 'mqtt error'));
    await client.subscribeAsync(
      SUBSCRIPTIONS.map((k) => wildcardFor(k)),
      { qos: 1 },
    );
    client.on('connect', () => {
      this.opts.log.info({}, 'mqtt reconnected');
      this.fireConnect();
    });
    this.opts.log.info({ url: redact(this.opts.url) }, 'mqtt gateway connected');
    this.fireConnect();
  }

  async publishDesired(hardwareId: string, desired: DesiredState): Promise<void> {
    await this.publish(topicFor(hardwareId, 'desired'), JSON.stringify(desired), true);
  }

  /** Removes the retained desired state (device unclaimed). */
  async clearDesired(hardwareId: string): Promise<void> {
    await this.publish(topicFor(hardwareId, 'desired'), '', true);
  }

  async publishCommand(hardwareId: string, cmd: CommandPayload): Promise<void> {
    await this.publish(topicFor(hardwareId, 'cmd'), JSON.stringify(cmd), false);
  }

  /** Resolves when every queued inbound message has been handled (used by tests). */
  async idle(): Promise<void> {
    await Promise.all([...this.queues.values()]);
  }

  async close(): Promise<void> {
    await this.idle();
    await this.client?.endAsync();
    this.client = null;
  }

  private async publish(topic: string, payload: string, retain: boolean) {
    if (!this.client) throw new Error('MQTT gateway not started');
    await this.client.publishAsync(topic, payload, { qos: 1, retain });
  }

  private onMessage(topic: string, raw: Buffer) {
    const parsed = parseTopic(topic);
    if (!parsed) return;
    const { hardwareId, kind } = parsed;
    if (raw.length > MAX_DEVICE_MESSAGE_BYTES) {
      this.opts.log.warn({ hardwareId, kind, bytes: raw.length }, 'oversized mqtt message dropped');
      return;
    }
    const at = this.now();
    const prev = this.queues.get(hardwareId) ?? Promise.resolve();
    const next = prev
      .then(() => this.dispatch(hardwareId, kind, raw, at))
      .catch((err) => this.opts.log.error({ err, hardwareId, kind }, 'mqtt handler failed'))
      .finally(() => {
        if (this.queues.get(hardwareId) === next) this.queues.delete(hardwareId);
      });
    this.queues.set(hardwareId, next);
  }

  private async dispatch(hardwareId: string, kind: string, raw: Buffer, at: Date) {
    const h = this.handlers;
    if (!h) return;
    const text = raw.toString('utf8');
    if (!text) return; // cleared retained message

    const invalid = (issues: unknown) =>
      this.opts.log.warn({ hardwareId, kind, issues }, 'mqtt payload rejected');

    if (kind === 'status') {
      const r = statusPayload.safeParse(text.trim().replace(/^"|"$/g, ''));
      return r.success ? h.status(hardwareId, r.data === 'online', at) : invalid(r.error.issues);
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return invalid('not json');
    }

    switch (kind) {
      case 'telemetry': {
        const r = telemetryPayload.safeParse(json);
        return r.success ? h.telemetry(hardwareId, r.data, at) : invalid(r.error.issues);
      }
      case 'reported': {
        const r = reportedPayload.safeParse(json);
        return r.success ? h.reported(hardwareId, r.data, at) : invalid(r.error.issues);
      }
      case 'event': {
        const r = eventPayload.safeParse(json);
        return r.success ? h.event(hardwareId, r.data, at) : invalid(r.error.issues);
      }
      case 'cmdAck': {
        const r = commandAckPayload.safeParse(json);
        return r.success ? h.cmdAck(hardwareId, r.data, at) : invalid(r.error.issues);
      }
    }
  }
}

const redact = (url: string) => url.replace(/\/\/[^@/]*@/, '//***@');
