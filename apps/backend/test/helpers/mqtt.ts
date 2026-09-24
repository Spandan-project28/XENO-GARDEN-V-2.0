import mqtt, { type MqttClient } from 'mqtt';
import { topicFor } from '@xeno/shared';

export const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

/** Connects like the ESP32 does: clientId = username = hardwareId, LWT on status. */
export async function connectDevice(
  port: number,
  hardwareId: string,
  password: string,
  opts: { clientId?: string } = {},
): Promise<MqttClient> {
  return mqtt.connectAsync(`mqtt://127.0.0.1:${port}`, {
    clientId: opts.clientId ?? hardwareId,
    username: hardwareId,
    password,
    reconnectPeriod: 0,
    connectTimeout: 5000,
    will: { topic: topicFor(hardwareId, 'status'), payload: Buffer.from('offline'), qos: 1, retain: true },
  });
}

export const waitFor = async (cond: () => boolean | Promise<boolean>, timeoutMs = 5000) => {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
