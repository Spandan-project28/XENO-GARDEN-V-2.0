/**
 * One typed function per backend endpoint. Responses are validated with the same Zod schemas the
 * backend uses, so contract drift fails loudly instead of rendering garbage.
 */
import {
  alertCounts,
  attachPhotoResponse,
  photoUploadResponse,
  alertPublic,
  authResponse,
  authTokens,
  claimResponse,
  devicePublic,
  firmwareStatus,
  healthReport,
  healthResponse,
  notificationPrefs,
  paginated,
  plantPublic,
  pumpCommandResponse,
  pumpEvent,
  readingsResponse,
  scanList,
  scanPublic,
  scanServiceStatus,
  scanUploadResponse,
  userPublic,
  type AlertStatus,
  type ClaimBody,
  type DeviceCommandType,
  type DeviceMode,
  type DeviceSettingsPatch,
  type LoginBody,
  type NotificationPrefs,
  type PlantBody,
  type PumpCommandBody,
  type ReadingResolution,
  type RegisterBody,
  type UpdateDeviceBody,
  type UpgradeBody,
} from '@xeno/shared';
import { z } from 'zod';
import type { ApiClient } from './client';

const ok = z.object({ ok: z.literal(true) });

export function createEndpoints(api: ApiClient) {
  return {
    auth: {
      guest: () => api.post('/v1/auth/guest', undefined, { auth: false, schema: authResponse }),
      upgrade: (body: UpgradeBody) => api.post('/v1/auth/upgrade', body, { schema: userPublic }),
      register: (body: RegisterBody) => api.post('/v1/auth/register', body, { auth: false, schema: authResponse }),
      login: (body: LoginBody) => api.post('/v1/auth/login', body, { auth: false, schema: authResponse }),
      refresh: (refreshToken: string) =>
        api.post('/v1/auth/refresh', { refreshToken }, { auth: false, schema: authTokens }),
      logout: (refreshToken: string) => api.post('/v1/auth/logout', { refreshToken }, { auth: false, schema: ok }),
      me: () => api.get('/v1/me', { schema: userPublic }),
      updateMe: (body: { name?: string }) => api.patch('/v1/me', body, { schema: userPublic }),
    },

    devices: {
      list: () =>
        api.get('/v1/devices', { schema: z.object({ items: z.array(devicePublic) }) }).then((r) => r.items),
      get: (id: string) => api.get(`/v1/devices/${id}`, { schema: devicePublic }),
      claim: (body: ClaimBody) => api.post('/v1/devices/claim', body, { schema: claimResponse }),
      update: (id: string, body: UpdateDeviceBody) => api.patch(`/v1/devices/${id}`, body, { schema: devicePublic }),
      remove: (id: string) => api.delete(`/v1/devices/${id}`, undefined, { schema: ok }),
      updateSettings: (id: string, patch: DeviceSettingsPatch) =>
        api.put(`/v1/devices/${id}/settings`, patch, { schema: devicePublic }),
      setMode: (id: string, mode: DeviceMode) =>
        api.put(`/v1/devices/${id}/mode`, { mode }, { schema: devicePublic }),
      pump: (id: string, body: PumpCommandBody) =>
        api.post(`/v1/devices/${id}/pump`, body, { schema: pumpCommandResponse }),
      firmware: (id: string) => api.get(`/v1/devices/${id}/firmware`, { schema: firmwareStatus }),
      updateFirmware: (id: string) =>
        api.post(`/v1/devices/${id}/firmware/update`, undefined, { schema: z.object({ cmdId: z.string() }) }),
      command: (id: string, type: Exclude<DeviceCommandType, 'ota'>) =>
        api.post(`/v1/devices/${id}/commands`, { type }, { schema: z.object({ cmdId: z.string() }) }),
      readings: (id: string, q: { from: string; to: string; resolution?: ReadingResolution; tz?: string }) =>
        api.get(`/v1/devices/${id}/readings`, { query: q, schema: readingsResponse }),
      pumpEvents: (id: string, q: { from: string; to: string }) =>
        api
          .get(`/v1/devices/${id}/pump-events`, { query: q, schema: z.object({ items: z.array(pumpEvent) }) })
          .then((r) => r.items),
    },

    alerts: {
      list: (q: { status?: AlertStatus[]; deviceId?: string; cursor?: string | null; limit?: number }) =>
        api.get('/v1/alerts', {
          query: { status: q.status?.join(','), deviceId: q.deviceId, cursor: q.cursor, limit: q.limit },
          schema: paginated(alertPublic),
        }),
      counts: () => api.get('/v1/alerts/counts', { schema: alertCounts }),
      ack: (id: string) => api.post(`/v1/alerts/${id}/ack`, undefined, { schema: alertPublic }),
      resolve: (id: string) => api.post(`/v1/alerts/${id}/resolve`, undefined, { schema: alertPublic }),
    },

    notifications: {
      registerToken: (token: string, platform: 'ios' | 'android' | 'web') =>
        api.post('/v1/me/push-tokens', { token, platform }, { schema: ok }),
      removeToken: (token: string) => api.delete('/v1/me/push-tokens', { token }, { schema: ok }),
      getPrefs: () => api.get('/v1/me/notification-prefs', { schema: notificationPrefs }),
      setPrefs: (prefs: NotificationPrefs) => api.put('/v1/me/notification-prefs', prefs, { schema: notificationPrefs }),
    },

    scans: {
      status: () => api.get('/v1/scans/status', { schema: scanServiceStatus }),
      uploadUrl: (contentType: 'image/jpeg' | 'image/png' | 'image/webp') =>
        api.post('/v1/scans/upload-url', { contentType }, { schema: scanUploadResponse }),
      // The model may take a while (cold start, slow network): allow up to a minute.
      create: (body: { photoId: string; deviceId?: string | null }) =>
        api.post('/v1/scans', body, { schema: scanPublic, timeoutMs: 60_000 }),
      list: (q: { deviceId?: string; limit?: number; cursor?: string | null } = {}) =>
        api.get('/v1/scans', { query: { deviceId: q.deviceId, limit: q.limit, cursor: q.cursor }, schema: scanList }),
      get: (id: string) => api.get(`/v1/scans/${id}`, { schema: scanPublic }),
      remove: (id: string) => api.delete(`/v1/scans/${id}`, undefined, { schema: ok }),
    },

    plants: {
      list: () => api.get('/v1/plants', { schema: z.object({ items: z.array(plantPublic) }) }).then((r) => r.items),
      create: (body: PlantBody) => api.post('/v1/plants', body, { schema: plantPublic }),
      update: (id: string, body: Partial<PlantBody>) => api.patch(`/v1/plants/${id}`, body, { schema: plantPublic }),
      remove: (id: string) => api.delete(`/v1/plants/${id}`, undefined, { schema: ok }),
      health: (id: string) => api.get(`/v1/plants/${id}/health`, { schema: healthResponse }),
      runHealth: (id: string) => api.post(`/v1/plants/${id}/health/run`, undefined, { schema: healthReport }),
      photoUploadUrl: (id: string, contentType: 'image/jpeg' | 'image/png' | 'image/webp') =>
        api.post(`/v1/plants/${id}/photos/upload-url`, { contentType }, { schema: photoUploadResponse }),
      attachPhoto: (id: string, photoId: string, analyze: boolean) =>
        api.post(`/v1/plants/${id}/photos`, { photoId, analyze }, { schema: attachPhotoResponse }),
    },
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
