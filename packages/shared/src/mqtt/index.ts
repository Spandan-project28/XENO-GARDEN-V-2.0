import { z } from 'zod';
import { DEVICE_COMMAND_TYPES, DEVICE_EVENT_TYPES, MQTT_ROOT } from '../constants/index.js';
import { desiredState, reportedState } from '../schemas/device.js';

/** Leaf topic names under `xg/v1/{hardwareId}/`. */
export const TOPICS = {
  telemetry: 'telemetry',
  reported: 'reported',
  desired: 'desired',
  cmd: 'cmd',
  cmdAck: 'cmd/ack',
  status: 'status',
  event: 'event',
} as const;
export type TopicKind = keyof typeof TOPICS;

export const topicFor = (hardwareId: string, kind: TopicKind): string =>
  `${MQTT_ROOT}/${hardwareId}/${TOPICS[kind]}`;

/** Subscription filter for every device, e.g. `xg/v1/+/telemetry`. */
export const wildcardFor = (kind: TopicKind): string => `${MQTT_ROOT}/+/${TOPICS[kind]}`;

const leafToKind = new Map<string, TopicKind>(
  (Object.entries(TOPICS) as [TopicKind, string][]).map(([k, v]) => [v, k]),
);

/** Parses `xg/v1/{hwId}/{leaf}` into its parts. Returns null for anything else. */
export function parseTopic(topic: string): { hardwareId: string; kind: TopicKind } | null {
  const prefix = `${MQTT_ROOT}/`;
  if (!topic.startsWith(prefix)) return null;
  const rest = topic.slice(prefix.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const hardwareId = rest.slice(0, slash);
  const kind = leafToKind.get(rest.slice(slash + 1));
  if (!kind) return null;
  return { hardwareId, kind };
}

const pct = z.number().min(0).max(100);

/** device → cloud, every telemetryIntervalSec and immediately when the pump changes. */
export const telemetryPayload = z.object({
  /** Device epoch ms (from NTP). 0 or missing = unknown clock; the server uses receive time. */
  ts: z.number().int().nonnegative().optional(),
  soilMoisture: pct.nullable(),
  soilRaw: z.number().int().min(0).max(4095).nullable(),
  temperature: z.number().min(-40).max(85).nullable(),
  humidity: pct.nullable(),
  rain: z.boolean(),
  pump: z.boolean(),
});
export type TelemetryPayload = z.infer<typeof telemetryPayload>;

export const reportedPayload = reportedState;
export type ReportedPayload = z.infer<typeof reportedPayload>;

export const desiredPayload = desiredState;
export type DesiredPayload = z.infer<typeof desiredPayload>;

export const commandPayload = z.object({
  cmdId: z.string().min(4).max(40),
  type: z.enum(DEVICE_COMMAND_TYPES),
  issuedAt: z.number().int().nonnegative(),
});
export type CommandPayload = z.infer<typeof commandPayload>;

export const commandAckPayload = z.object({
  cmdId: z.string().min(1).max(40),
  ok: z.boolean(),
  error: z.string().max(200).optional(),
});
export type CommandAckPayload = z.infer<typeof commandAckPayload>;

export const statusPayload = z.enum(['online', 'offline']);
export type StatusPayload = z.infer<typeof statusPayload>;

export const eventPayload = z.object({
  type: z.enum(DEVICE_EVENT_TYPES),
  ts: z.number().int().nonnegative().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type EventPayload = z.infer<typeof eventPayload>;

/** Payload schema per inbound (device → cloud) topic kind. */
export const inboundSchemas = {
  telemetry: telemetryPayload,
  reported: reportedPayload,
  cmdAck: commandAckPayload,
  event: eventPayload,
} as const;
