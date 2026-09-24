import mqtt, { type MqttClient } from 'mqtt';
import { topicFor } from '@xeno/shared';
import type { SimTransport } from './device.js';

export interface MqttTransportOptions {
  url: string;
  hardwareId: string;
  password: string;
}

/** Real MQTT transport, configured exactly like the firmware (clientId = username = hardwareId, LWT). */
export class MqttTransport implements SimTransport {
  private client: MqttClient | null = null;
  private messageHandler: (topic: string, payload: string) => void = () => {};
  private connHandler: (connected: boolean) => void = () => {};
  private reconnectTimer: NodeJS.Timeout | null = null;
  private ended = false;

  constructor(private readonly opts: MqttTransportOptions) {}

  async connect(): Promise<void> {
    const { url, hardwareId, password } = this.opts;
    const client = mqtt.connect(url, {
      clientId: hardwareId,
      username: hardwareId,
      password,
      clean: true,
      keepalive: 15,
      reconnectPeriod: 3000,
      connectTimeout: 10_000,
      will: { topic: topicFor(hardwareId, 'status'), payload: Buffer.from('offline'), qos: 1, retain: true },
    });
    this.client = client;
    client.on('message', (topic, payload) => this.messageHandler(topic, payload.toString('utf8')));
    client.on('connect', () => this.connHandler(true));
    client.on('close', () => this.connHandler(false));
    await new Promise<void>((resolve, reject) => {
      const onErr = (err: Error) => reject(err);
      client.once('connect', () => {
        client.off('error', onErr);
        resolve();
      });
      client.once('error', onErr);
    });
  }

  publish(topic: string, payload: string, opts: { retain?: boolean; qos?: 0 | 1 }) {
    this.client?.publish(topic, payload, { retain: opts.retain ?? false, qos: opts.qos ?? 0 });
  }

  async subscribe(topics: string[]) {
    await this.client?.subscribeAsync(topics, { qos: 1 });
  }

  onMessage(handler: (topic: string, payload: string) => void) {
    this.messageHandler = handler;
  }

  onConnectionChange(handler: (connected: boolean) => void) {
    this.connHandler = handler;
  }

  isConnected() {
    return this.client?.connected ?? false;
  }

  drop(reconnectAfterMs: number | null) {
    const c = this.client;
    if (!c) return;
    c.options.reconnectPeriod = 0; // take manual control of the reconnect
    c.stream.destroy();
    if (reconnectAfterMs !== null) {
      this.reconnectTimer = setTimeout(() => {
        if (this.ended) return;
        c.options.reconnectPeriod = 3000;
        c.reconnect();
      }, reconnectAfterMs);
    }
  }

  async end() {
    this.ended = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    await this.client?.endAsync(true).catch(() => {});
  }
}
