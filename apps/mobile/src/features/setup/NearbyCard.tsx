import { router } from 'expo-router';
import { Sprout, Wifi } from 'lucide-react-native';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/design';
import { Button, Card, Text } from '@/ui';
import { useAutoSetup } from './controller';

/** How long the Garden screen looks around quietly before giving the radio a rest. */
const QUIET_SCAN_MS = 30_000;

/**
 * "2 Xeno devices nearby → Connect" on the Garden screen. Discovery only starts by itself when
 * it can do so without any OS prompt (permission already granted, Bluetooth on); otherwise the
 * user starts it with "Find my devices".
 */
export function NearbyCard() {
  const t = useTheme();
  const [setup, s] = useAutoSetup();

  useEffect(() => {
    let stop: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    void (async () => {
      if (setup.getState().phase !== 'idle') return;
      if (!(await setup.canDiscoverQuietly())) return;
      if (!alive) return;
      await setup.discover();
      stop = setTimeout(() => setup.stopDiscovery(), QUIET_SCAN_MS);
    })();
    return () => {
      alive = false;
      if (stop) clearTimeout(stop);
      if (setup.getState().phase === 'scanning') setup.stopDiscovery();
    };
  }, [setup]);

  const waiting = s.items.filter((i) => i.status === 'found');
  if (!waiting.length || s.phase === 'running') return null;

  const fresh = waiting.filter((i) => i.kind === 'new');
  const rejoin = waiting.filter((i) => i.kind === 'rejoin');
  const names = waiting.map((i) => i.label).join(', ');
  const title =
    fresh.length && !rejoin.length
      ? fresh.length === 1
        ? 'New device nearby'
        : `${fresh.length} new devices nearby`
      : rejoin.length === 1 && !fresh.length
        ? `${rejoin[0]!.label} needs WiFi`
        : `${waiting.length} devices need setup`;

  const connect = () => {
    void setup.connectAll();
    router.push('/setup');
  };

  return (
    <Animated.View entering={FadeInDown.springify().damping(18)}>
      <Card variant="tinted" tint={t.colors.accentSoft} padding={t.space.xl} testID="nearby-card">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.lg }}>
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: t.colors.surface,
            }}
          >
            <Sprout size={26} color={t.colors.accent} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading">{title}</Text>
            <Text variant="caption" tone="textSecondary" numberOfLines={2}>
              {names}
            </Text>
          </View>
        </View>
        <Button
          title={rejoin.length && !fresh.length ? 'Fix WiFi' : 'Connect'}
          icon={Wifi}
          onPress={connect}
          fullWidth
          style={{ marginTop: t.space.lg }}
          testID="nearby-connect"
        />
      </Card>
    </Animated.View>
  );
}
