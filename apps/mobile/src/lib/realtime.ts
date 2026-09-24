/**
 * Live connection to the backend (Socket.IO /rt). Keeps ref-counted device subscriptions,
 * resubscribes after reconnects, refreshes the token when the server rejects it, and patches the
 * query cache so every screen updates instantly.
 */
import type { QueryClient } from '@tanstack/react-query';
import {
  SOCKET,
  type RtAlert,
  type RtClientToServer,
  type RtDeviceRemoved,
  type RtServerToClient,
  type RtShadow,
  type RtStatus,
  type RtSubscribeAck,
  type RtTelemetry,
} from '@xeno/shared';
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import { env } from '@/config/env';
import { apiClient } from './api';
import { applyShadow, applyStatus, applyTelemetry, patchDevice, removeDevice, upsertDevice } from './deviceCache';
import { useLiveTelemetry } from './liveTelemetry';
import { qk } from './queryKeys';
import { sessionStore } from './session';

export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';
export const useRealtimeStatus = create<{ status: RealtimeStatus; changedAt: number }>(() => ({
  status: 'idle',
  changedAt: Date.now(),
}));
const setStatus = (status: RealtimeStatus) => {
  if (useRealtimeStatus.getState().status !== status) useRealtimeStatus.setState({ status, changedAt: Date.now() });
};

type AppSocket = Socket<RtServerToClient, RtClientToServer>;
export type SocketFactory = (url: string, auth: (cb: (data: object) => void) => void) => AppSocket;

const defaultFactory: SocketFactory = (url, auth) =>
  io(url, {
    auth,
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
    timeout: 10_000,
  }) as AppSocket;

export class RealtimeManager {
  private socket: AppSocket | null = null;
  private readonly subs = new Map<string, number>();
  private qc: QueryClient | null = null;

  constructor(
    private readonly factory: SocketFactory = defaultFactory,
    private readonly baseUrl: () => string | null = () => env.apiUrl,
  ) {}

  get subscribedIds() {
    return [...this.subs.keys()];
  }

  async start(qc: QueryClient) {
    if (this.socket) return;
    const base = this.baseUrl();
    if (!base) return;
    this.qc = qc;
    // A restored session has no access token yet — get one before connecting.
    if (!sessionStore.getAccessToken()) {
      const ok = await apiClient.refreshOnce().catch(() => null);
      if (!ok) return;
    }
    setStatus('connecting');
    const socket = this.factory(`${base}${SOCKET.namespace}`, (cb) => cb({ token: sessionStore.getAccessToken() }));
    this.socket = socket;

    socket.on('connect', () => {
      setStatus('connected');
      for (const id of this.subs.keys()) this.emitSubscribe(id);
    });
    socket.on('disconnect', () => setStatus('disconnected'));
    socket.on('connect_error', async (err) => {
      setStatus('disconnected');
      if (err.message === 'UNAUTHORIZED') {
        // Server middleware rejected the token: refresh and reconnect manually.
        const token = await apiClient.refreshOnce().catch(() => null);
        if (token && this.socket === socket) socket.connect();
      }
    });

    socket.on('telemetry', (e: RtTelemetry) => {
      useLiveTelemetry.getState().push(e);
      patchDevice(qc, e.deviceId, applyTelemetry(e));
    });
    socket.on('shadow', (e: RtShadow) => patchDevice(qc, e.deviceId, applyShadow(e)));
    socket.on('status', (e: RtStatus) => patchDevice(qc, e.deviceId, applyStatus(e)));
    socket.on('device_removed', (e: RtDeviceRemoved) => removeDevice(qc, e.deviceId));
    socket.on('alert', (_e: RtAlert) => {
      void qc.invalidateQueries({ queryKey: qk.alertsAll });
    });
  }

  stop() {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.subs.clear();
    setStatus('idle');
  }

  subscribe(deviceId: string) {
    const n = this.subs.get(deviceId) ?? 0;
    this.subs.set(deviceId, n + 1);
    if (n === 0 && this.socket?.connected) this.emitSubscribe(deviceId);
  }

  unsubscribe(deviceId: string) {
    const n = this.subs.get(deviceId) ?? 0;
    if (n <= 1) {
      this.subs.delete(deviceId);
      if (this.socket?.connected) this.socket.emit('unsubscribe', { deviceId });
    } else {
      this.subs.set(deviceId, n - 1);
    }
  }

  private emitSubscribe(deviceId: string) {
    this.socket?.emit('subscribe', { deviceId }, (ack: RtSubscribeAck) => {
      if (!this.qc) return;
      if (ack.ok) upsertDevice(this.qc, ack.device);
      else if (ack.error === 'NOT_FOUND') removeDevice(this.qc, deviceId);
    });
  }
}

export const realtime = new RealtimeManager();

/** Subscribes the component to live updates for the given devices while mounted. */
export function useLiveDevices(ids: readonly string[]) {
  const key = [...ids].sort().join(',');
  useEffect(() => {
    const list = key ? key.split(',') : [];
    list.forEach((id) => realtime.subscribe(id));
    return () => list.forEach((id) => realtime.unsubscribe(id));
  }, [key]);
}
