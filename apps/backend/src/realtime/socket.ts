/**
 * Realtime gateway for apps: Socket.IO namespace /rt. Bridges bus events to rooms:
 *   user:{userId}     — every socket of that user (status, alerts, removals)
 *   device:{deviceId} — sockets that subscribed to a device (telemetry, shadow, events)
 */
import type { Server as HttpServer } from 'node:http';
import { Server, type Namespace } from 'socket.io';
import {
  SOCKET,
  type RtClientToServer,
  type RtServerToClient,
  type RtSubscribeAck,
} from '@xeno/shared';
import { Types } from 'mongoose';
import type { Deps } from '../deps.js';

interface SocketData {
  userId: string;
}

export type RealtimeNamespace = Namespace<RtClientToServer, RtServerToClient, Record<string, never>, SocketData>;

const userRoom = (id: string) => `user:${id}`;
const deviceRoom = (id: string) => `device:${id}`;

export function attachRealtime(httpServer: HttpServer, deps: Deps) {
  const io = new Server<RtClientToServer, RtServerToClient, Record<string, never>, SocketData>(httpServer, {
    cors: { origin: deps.env.CORS_ORIGINS.length ? deps.env.CORS_ORIGINS : '*' },
    pingInterval: 20_000,
    pingTimeout: 20_000,
    serveClient: false,
  });
  const nsp: RealtimeNamespace = io.of(SOCKET.namespace);

  nsp.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof token !== 'string') return next(new Error('UNAUTHORIZED'));
    try {
      socket.data.userId = deps.tokens.verify(token).sub;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  nsp.on('connection', (socket) => {
    void socket.join(userRoom(socket.data.userId));

    socket.on('subscribe', async (req, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const deviceId = req?.deviceId;
      if (typeof deviceId !== 'string' || !Types.ObjectId.isValid(deviceId)) {
        return reply({ ok: false, error: 'BAD_REQUEST' } satisfies RtSubscribeAck);
      }
      try {
        const device = await deps.services.devices.get(socket.data.userId, deviceId);
        await socket.join(deviceRoom(deviceId));
        reply({ ok: true, device });
      } catch {
        reply({ ok: false, error: 'NOT_FOUND' });
      }
    });

    socket.on('unsubscribe', (req) => {
      if (typeof req?.deviceId === 'string') void socket.leave(deviceRoom(req.deviceId));
    });
  });

  const { bus } = deps;
  const offs = [
    bus.on('device.telemetry', (e) => {
      nsp.to(deviceRoom(e.deviceId)).emit('telemetry', {
        ...e.payload,
        deviceId: e.deviceId,
        at: e.ts.toISOString(),
      });
    }),
    bus.on('device.reported', (e) => {
      nsp.to(deviceRoom(e.deviceId)).emit('shadow', {
        deviceId: e.deviceId,
        reported: { ...e.reported, at: e.at.toISOString() },
      });
    }),
    bus.on('device.desired', (e) => {
      nsp.to(deviceRoom(e.deviceId)).emit('shadow', { deviceId: e.deviceId, desired: e.desired });
    }),
    bus.on('device.status', (e) => {
      nsp.to(userRoom(e.ownerId)).emit('status', {
        deviceId: e.deviceId,
        online: e.online,
        at: e.at.toISOString(),
      });
    }),
    bus.on('device.event', (e) => {
      nsp.to(deviceRoom(e.deviceId)).emit('device_event', {
        deviceId: e.deviceId,
        event: e.event,
        at: e.at.toISOString(),
      });
    }),
    bus.on('device.cmdAck', (e) => {
      nsp.to(deviceRoom(e.deviceId)).emit('cmd_ack', { deviceId: e.deviceId, ack: e.ack });
    }),
    bus.on('device.removed', (e) => {
      nsp.to(userRoom(e.ownerId)).emit('device_removed', { deviceId: e.deviceId });
      nsp.in(deviceRoom(e.deviceId)).socketsLeave(deviceRoom(e.deviceId));
    }),
    bus.on('alert.opened', (e) => {
      nsp.to(userRoom(e.ownerId)).emit('alert', { alert: e.alert });
    }),
    bus.on('alert.updated', (e) => {
      nsp.to(userRoom(e.ownerId)).emit('alert', { alert: e.alert });
    }),
  ];

  return {
    io,
    nsp,
    close: async () => {
      offs.forEach((off) => off());
      await io.close();
    },
  };
}
export type Realtime = ReturnType<typeof attachRealtime>;
