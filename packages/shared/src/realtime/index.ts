/**
 * Socket.IO (namespace `/rt`) payload types. Server → client events are listed in SOCKET.
 * The client authenticates with `auth: { token: <accessToken> }` and then emits
 * `subscribe` with `{ deviceId }` for each device it wants live data for.
 */
import type { AlertPublic } from '../schemas/alert.js';
import type { DesiredState, DevicePublic, ReportedState } from '../schemas/device.js';
import type { CommandAckPayload, EventPayload, TelemetryPayload } from '../mqtt/index.js';

export interface RtTelemetry extends TelemetryPayload {
  deviceId: string;
  /** ISO time the reading was taken (server-corrected). */
  at: string;
}

export interface RtShadow {
  deviceId: string;
  desired?: DesiredState;
  reported?: ReportedState & { at: string };
  syncPending?: boolean;
}

export interface RtStatus {
  deviceId: string;
  online: boolean;
  at: string;
}

export interface RtDeviceEvent {
  deviceId: string;
  event: EventPayload;
  at: string;
}

export interface RtCmdAck {
  deviceId: string;
  ack: CommandAckPayload;
}

export interface RtAlert {
  alert: AlertPublic;
}

export interface RtDeviceRemoved {
  deviceId: string;
}

export interface RtSubscribeRequest {
  deviceId: string;
}

export type RtSubscribeAck =
  | { ok: true; device: DevicePublic }
  | { ok: false; error: 'NOT_FOUND' | 'BAD_REQUEST' };

export interface RtServerToClient {
  telemetry: (e: RtTelemetry) => void;
  shadow: (e: RtShadow) => void;
  status: (e: RtStatus) => void;
  device_event: (e: RtDeviceEvent) => void;
  cmd_ack: (e: RtCmdAck) => void;
  alert: (e: RtAlert) => void;
  device_removed: (e: RtDeviceRemoved) => void;
}

export interface RtClientToServer {
  subscribe: (req: RtSubscribeRequest, ack: (res: RtSubscribeAck) => void) => void;
  unsubscribe: (req: RtSubscribeRequest) => void;
}
