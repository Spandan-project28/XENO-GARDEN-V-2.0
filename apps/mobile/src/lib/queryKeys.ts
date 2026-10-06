/** Every query key in one place, so invalidation is predictable. */
export const qk = {
  me: ['me'] as const,
  devices: ['devices'] as const,
  device: (id: string) => ['devices', id] as const,
  readings: (id: string, rangeKey: string) => ['devices', id, 'readings', rangeKey] as const,
  firmware: (id: string) => ['devices', id, 'firmware'] as const,
  pumpEvents: (id: string, rangeKey: string) => ['devices', id, 'pump-events', rangeKey] as const,
  alerts: (filter: string) => ['alerts', 'list', filter] as const,
  alertsAll: ['alerts'] as const,
  alertCounts: ['alerts', 'counts'] as const,
  plants: ['plants'] as const,
  plantHealth: (id: string) => ['plants', id, 'health'] as const,
  notificationPrefs: ['notification-prefs'] as const,
  scansAll: ['scans'] as const,
  scanStatus: ['scans', 'status'] as const,
  scans: (deviceId?: string) => ['scans', 'list', deviceId ?? 'all'] as const,
  scan: (id: string) => ['scans', 'item', id] as const,
};
