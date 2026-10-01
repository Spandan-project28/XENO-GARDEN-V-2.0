import type { DevicePublic } from '@xeno/shared';
import { router } from 'expo-router';
import { Bluetooth, Droplets, Leaf, Plus, Wifi } from 'lucide-react-native';
import { useMemo } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ConnectionBanner } from '@/components/ConnectionBanner';
import { PushPrompt } from '@/components/PushPrompt';
import { useTheme } from '@/design';
import { NearbyCard } from '@/features/setup/NearbyCard';
import { errorMessage } from '@/lib/api';
import { greeting } from '@/lib/format';
import { useLiveDevices } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { useNow } from '@/lib/useNow';
import { Banner, Button, Card, EmptyState, IconButton, Screen, SkeletonCard, Text } from '@/ui';
import { DeviceCard } from './DeviceCard';
import { pumpState, useDevices } from './hooks';

export function HomeScreen() {
  const t = useTheme();
  const user = useSession((s) => s.user);
  const devices = useDevices();
  const now = useNow(30_000);
  const list = useMemo(() => devices.data ?? [], [devices.data]);
  useLiveDevices(list.map((d) => d.id));

  // Guests have a placeholder name ("My garden"), so they get a plain greeting.
  const firstName = user && !user.guest ? user.name.split(' ')[0] : undefined;
  const addDevice = () => router.push('/setup');

  return (
    <Screen
      withTabBar
      eyebrow={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
      title="Your garden"
      headerRight={<IconButton icon={Plus} accessibilityLabel="Add devices" onPress={addDevice} testID="home-add-device" />}
      refreshing={devices.isRefetching}
      onRefresh={() => void devices.refetch()}
      testID="home-screen"
    >
      <View style={{ gap: t.space.lg }}>
        <ConnectionBanner />
        <NearbyCard />

        {devices.isPending ? (
          <>
            <SkeletonCard height={250} />
            <SkeletonCard height={250} />
          </>
        ) : devices.isError && !list.length ? (
          <Banner
            tone="danger"
            title="Couldn't load your garden"
            message={errorMessage(devices.error)}
            action={<Button title="Retry" size="md" variant="secondary" onPress={() => void devices.refetch()} />}
          />
        ) : list.length === 0 ? (
          <Card variant="glass" padding={t.space.xl}>
            <EmptyState
              icon={Bluetooth}
              title="Let’s find your devices"
              message="Switch on your Xeno devices and keep your phone close. The app finds them and connects them for you."
              actionLabel="Find my devices"
              onAction={addDevice}
            />
          </Card>
        ) : (
          <>
            <Overview devices={list} />
            <PushPrompt />
            {list.map((d, i) => (
              <Animated.View key={d.id} entering={FadeInDown.delay(i * 60).springify().damping(18)}>
                <DeviceCard device={d} now={now} onPress={() => router.push(`/device/${d.id}`)} />
              </Animated.View>
            ))}
          </>
        )}
      </View>
    </Screen>
  );
}

function Overview({ devices }: { devices: DevicePublic[] }) {
  const t = useTheme();
  const online = devices.filter((d) => d.online).length;
  const watering = devices.filter((d) => pumpState(d).on).length;
  const thirsty = devices.filter(
    (d) => d.latest?.soilMoisture !== null && d.latest !== null && d.latest.soilMoisture < d.desired.settings.moistureLow,
  ).length;
  const items = [
    { icon: Wifi, label: 'Online', value: `${online}/${devices.length}`, color: t.colors.accent, bg: t.colors.accentSoft },
    { icon: Droplets, label: 'Watering', value: String(watering), color: t.colors.water, bg: t.colors.waterSoft },
    { icon: Leaf, label: 'Thirsty', value: String(thirsty), color: thirsty ? t.colors.warning : t.colors.accent, bg: thirsty ? t.colors.warningSoft : t.colors.accentSoft },
  ];
  return (
    <View style={{ flexDirection: 'row', gap: t.space.sm }}>
      {items.map(({ icon: Icon, label, value, color, bg }) => (
        <View
          key={label}
          accessible
          accessibilityLabel={`${label}: ${value}`}
          style={{
            flex: 1,
            padding: t.space.md,
            borderRadius: t.radius.md,
            backgroundColor: t.colors.surfaceGlass,
            borderWidth: 1,
            borderColor: t.colors.border,
            gap: 6,
          }}
        >
          <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: bg }}>
            <Icon size={15} color={color} />
          </View>
          <Text variant="metric" tabular>
            {value}
          </Text>
          <Text variant="caption" tone="textSecondary">
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}
