import { useQuery } from '@tanstack/react-query';
import type { DevicePublic } from '@xeno/shared';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  Clock,
  CloudRain,
  Cpu,
  Droplets,
  Hand,
  HeartPulse,
  RefreshCw,
  Settings2,
  Sun,
  Thermometer,
  Wifi,
} from 'lucide-react-native';
import { useMemo } from 'react';
import { View } from 'react-native';
import { ConnectionBanner } from '@/components/ConnectionBanner';
import { flags } from '@/config/flags';
import { useTheme } from '@/design';
import { api } from '@/lib/api';
import { durationText, formatPct, formatTemp, moistureState, pumpReasonText, relativeTime } from '@/lib/format';
import { useLiveTelemetry } from '@/lib/liveTelemetry';
import { usePrefs } from '@/lib/prefs';
import { qk } from '@/lib/queryKeys';
import { useLiveDevices } from '@/lib/realtime';
import { useNow } from '@/lib/useNow';
import {
  Badge,
  Banner,
  Card,
  EmptyState,
  Gauge,
  IconButton,
  ListGroup,
  ListRow,
  MetricTile,
  Screen,
  SegmentedControl,
  SkeletonCard,
  Text,
} from '@/ui';
import { Sparkline } from '@/ui/charts/Sparkline';
import { DeviceStatusBadge } from './DeviceCard';
import { useDevice } from './hooks';
import { useDeviceMutations } from './mutations';
import { PumpControl } from './PumpControl';

const FIVE_MIN = 5 * 60_000;

export function DeviceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const device = useDevice(id);
  useLiveDevices([id]);
  const now = useNow(30_000);

  if (!device.data) {
    return (
      <Screen headerLeft={<BackButton />} title=" ">
        {device.isError ? (
          <EmptyState icon={Cpu} title="Device not found" message="It may have been removed from your account." />
        ) : (
          <View style={{ gap: t.space.lg }}>
            <SkeletonCard height={320} />
            <SkeletonCard height={200} />
          </View>
        )}
      </Screen>
    );
  }
  return <DeviceDetail device={device.data} now={now} refreshing={device.isRefetching} onRefresh={() => void device.refetch()} />;
}

function BackButton() {
  return <IconButton icon={ArrowLeft} accessibilityLabel="Back" onPress={() => router.back()} />;
}

function DeviceDetail({
  device,
  now,
  refreshing,
  onRefresh,
}: {
  device: DevicePublic;
  now: number;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const t = useTheme();
  const units = usePrefs((s) => s.units);
  const { setMode } = useDeviceMutations(device.id);
  const s = device.desired.settings;
  const soil = device.latest?.soilMoisture ?? null;
  const state = moistureState(soil, s.moistureLow, s.moistureHigh);
  const temp = formatTemp(device.latest?.temperature, units);

  return (
    <Screen
      headerLeft={<BackButton />}
      title={device.name}
      headerRight={
        <IconButton
          icon={Settings2}
          accessibilityLabel="Device settings"
          onPress={() => router.push(`/device/${device.id}/settings`)}
          testID="device-settings-button"
        />
      }
      refreshing={refreshing}
      onRefresh={onRefresh}
      testID="device-detail"
    >
      <View style={{ gap: t.space.lg }}>
        <ConnectionBanner />
        {!device.online ? (
          <Banner
            tone="offline"
            title={`Offline · last seen ${relativeTime(device.lastSeenAt, now)}`}
            message="It keeps watering on its own schedule. Controls come back when it reconnects."
          />
        ) : null}

        {/* Hero */}
        <Card variant="glass" padding={t.space.xl}>
          <View style={{ alignItems: 'center', gap: t.space.md }}>
            <View style={{ flexDirection: 'row', gap: t.space.sm }}>
              <DeviceStatusBadge device={device} now={now} />
              {device.syncPending ? (
                <Badge label="Syncing to device…" color={t.colors.info} background={t.colors.waterSoft} dot pulse />
              ) : null}
            </View>
            <Gauge
              value={soil}
              size={240}
              label="Soil moisture"
              color={state === 'dry' ? t.colors.warning : t.colors.water}
              band={{ from: s.moistureLow, to: s.moistureHigh }}
              caption={`Target ${s.moistureLow}–${s.moistureHigh}%`}
              testID="moisture-gauge"
            />
            <Text variant="subheading" align="center" testID="pump-reason">
              {pumpReasonText(device.reported?.pumpReason)}
            </Text>
          </View>
        </Card>

        {/* Mode */}
        <Card>
          <View style={{ gap: t.space.md }}>
            <Text variant="overline" tone="textSecondary">
              Watering mode
            </Text>
            <SegmentedControl
              testID="mode-control"
              options={[
                { value: 'auto', label: 'Automatic', icon: Bot },
                { value: 'manual', label: 'Manual', icon: Hand },
              ]}
              value={device.desired.mode}
              onChange={(m) => setMode.mutate(m)}
            />
            <Text variant="caption" tone="textSecondary">
              {device.desired.mode === 'auto'
                ? `Waters below ${s.moistureLow}% and stops above ${s.moistureHigh}%${s.rainLockout ? ', skipping when it rains' : ''}. Works even without internet.`
                : 'The pump only runs when you tell it to.'}
            </Text>
          </View>
        </Card>

        <PumpControl device={device} />

        {/* Metrics */}
        <View style={{ flexDirection: 'row', gap: t.space.sm }}>
          <MetricTile icon={Thermometer} label="Temperature" value={temp.value} unit={temp.unit} color={t.colors.sun} background={t.colors.sunSoft} />
          <MetricTile
            icon={Droplets}
            label="Humidity"
            value={formatPct(device.latest?.humidity)}
            unit="%"
            color={t.colors.humidity}
            background={t.colors.humiditySoft}
          />
          <MetricTile
            icon={device.latest?.rain ? CloudRain : Sun}
            label="Rain"
            value={device.latest ? (device.latest.rain ? 'Yes' : 'No') : '—'}
            color={t.colors.rain}
            background={t.colors.rainSoft}
          />
        </View>

        <MoistureTrend device={device} now={now} />
        <LastWatering deviceId={device.id} now={now} />

        {flags.plantHealth ? (
          <Card onPress={() => router.push(`/device/${device.id}/health`)} testID="plant-health-link">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <HeartPulse size={20} color={t.colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="subheading">Plant health</Text>
                <Text variant="caption" tone="textSecondary">
                  Insights from watering patterns and climate
                </Text>
              </View>
              <ChevronRight size={18} color={t.colors.textTertiary} />
            </View>
          </Card>
        ) : null}

        <DeviceHealth device={device} now={now} />
      </View>
    </Screen>
  );
}

/** Last 24 h of soil moisture (5-minute buckets) plus live points received since. */
function MoistureTrend({ device, now }: { device: DevicePublic; now: number }) {
  const t = useTheme();
  const live = useLiveTelemetry((s) => s.byDevice[device.id]);
  const to = Math.ceil(now / FIVE_MIN) * FIVE_MIN;
  const from = to - 24 * 3600_000;
  const readings = useQuery({
    queryKey: qk.readings(device.id, `24h:${to}`),
    queryFn: () => api.devices.readings(device.id, { from: new Date(from).toISOString(), to: new Date(to).toISOString() }),
    staleTime: FIVE_MIN,
    placeholderData: (prev) => prev,
  });
  const values = useMemo(() => {
    const pts = readings.data?.points ?? [];
    const lastTs = pts.length ? Date.parse(pts[pts.length - 1]!.ts) : 0;
    const extra = (live ?? []).filter((p) => Date.parse(p.at) > lastTs).map((p) => p.soilMoisture);
    return [...pts.map((p) => p.soilMoisture), ...extra];
  }, [readings.data, live]);

  return (
    <Card onPress={() => router.push({ pathname: '/history', params: { deviceId: device.id } })} testID="trend-card">
      <View style={{ gap: t.space.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="overline" tone="textSecondary">
            Last 24 hours
          </Text>
          <Text variant="caption" tone="accent">
            History →
          </Text>
        </View>
        {values.length > 1 ? (
          <Sparkline values={values} height={80} accessibilityLabel="Soil moisture over the last 24 hours" />
        ) : (
          <Text variant="caption" tone="textSecondary">
            {readings.isPending ? 'Loading…' : 'Not enough data yet. Check back soon.'}
          </Text>
        )}
        {readings.data ? (
          <Text variant="caption" tone="textSecondary">
            Avg {formatPct(readings.data.stats.soilMoistureAvg)}% · watered {durationText(readings.data.stats.pumpOnSec)}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

function LastWatering({ deviceId, now }: { deviceId: string; now: number }) {
  const t = useTheme();
  const to = Math.ceil(now / FIVE_MIN) * FIVE_MIN;
  const events = useQuery({
    queryKey: qk.pumpEvents(deviceId, `7d:${to}`),
    queryFn: () =>
      api.devices.pumpEvents(deviceId, { from: new Date(to - 7 * 86_400_000).toISOString(), to: new Date(to).toISOString() }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  const last = events.data?.[0];
  return (
    <ListGroup title="Watering">
      <ListRow
        icon={Clock}
        title={last ? `Last watered ${relativeTime(last.startedAt, now)}` : 'No watering in the last week'}
        subtitle={
          last
            ? `${last.source === 'manual' ? 'By you' : 'Automatically'}${last.durationSec !== null ? ` · ${durationText(last.durationSec)}` : ' · running now'}`
            : undefined
        }
      />
      <ListRow
        icon={RefreshCw}
        title={`${events.data?.length ?? 0} sessions this week`}
        subtitle={
          events.data?.length
            ? `${durationText(events.data.reduce((a, e) => a + (e.durationSec ?? 0), 0))} total`
            : undefined
        }
        iconColor={t.colors.water}
      />
    </ListGroup>
  );
}

function DeviceHealth({ device, now }: { device: DevicePublic; now: number }) {
  const r = device.reported;
  const rssi = r?.rssi ?? null;
  const signal = rssi === null ? '—' : rssi > -60 ? 'Excellent' : rssi > -70 ? 'Good' : rssi > -80 ? 'Fair' : 'Weak';
  return (
    <ListGroup title="Device">
      <ListRow icon={Wifi} title={r?.ssid ?? 'WiFi'} subtitle={rssi !== null ? `${signal} signal (${rssi} dBm)` : 'No report yet'} />
      <ListRow icon={Cpu} title="Firmware" value={device.firmwareVersion ?? '—'} />
      <ListRow icon={Clock} title="Last seen" value={device.online ? 'Now' : relativeTime(device.lastSeenAt, now)} />
      <ListRow icon={Settings2} title="Hardware ID" subtitle={device.hardwareId} />
    </ListGroup>
  );
}
