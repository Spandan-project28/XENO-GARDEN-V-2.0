import { useNetInfo } from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { useRealtimeStatus } from '@/lib/realtime';
import { Banner } from '@/ui';

const RECONNECT_GRACE_MS = 4000;

/**
 * Tells the user, honestly, when data may be stale:
 *  • phone has no internet → "You're offline" (cached data still shown)
 *  • internet OK but live link to the server dropped for > 4 s → "Reconnecting…"
 */
export function ConnectionBanner() {
  const net = useNetInfo();
  const { status, changedAt } = useRealtimeStatus();
  const offline = net.isConnected === false || net.isInternetReachable === false;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status !== 'disconnected') return;
    const timer = setTimeout(() => setNow(Date.now()), RECONNECT_GRACE_MS + 100);
    return () => clearTimeout(timer);
  }, [status, changedAt]);

  if (offline) {
    return (
      <Banner
        tone="offline"
        title="You're offline"
        message="Showing the last known data. Your garden keeps watering on its own."
      />
    );
  }
  if (status === 'disconnected' && now - changedAt >= RECONNECT_GRACE_MS) {
    return <Banner tone="warning" title="Reconnecting to your garden…" message="Live updates will resume automatically." />;
  }
  return null;
}
