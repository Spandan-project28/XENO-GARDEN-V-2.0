import { useQuery } from '@tanstack/react-query';
import type { DevicePublic } from '@xeno/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { ChartSpline, Clock, Droplets, Sprout, Thermometer, Waves } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/design';
import { api, errorMessage } from '@/lib/api';
import { durationText, formatPct, formatTemp, relativeTime } from '@/lib/format';
import { usePrefs } from '@/lib/prefs';
import { qk } from '@/lib/queryKeys';
import { useNow } from '@/lib/useNow';
import {
  Banner,
  Card,
  ChipGroup,
  EmptyState,
  ListGroup,
  ListRow,
  MetricTile,
  Screen,
  SegmentedControl,
  Skeleton,
  Text,
} from '@/ui';
import { LineChart, type ChartPoint } from '@/ui/charts/LineChart';
import { useDevices } from '@/features/devices';
import { computeRange, deviceTimeZone, RANGES, timeFormatters, type RangeKey } from './ranges';

type Metric = 'soil' | 'temp' | 'humidity';

export function HistoryScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ deviceId?: string }>();
  const devices = useDevices();
  const lastDeviceId = usePrefs((s) => s.lastDeviceId);
  const setLastDeviceId = usePrefs((s) => s.setLastDeviceId);
  const list = devices.data ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const deviceId =
    [picked, params.deviceId, lastDeviceId].find((id) => id && list.some((d) => d.id === id)) ?? list[0]?.id ?? null;
  const device = list.find((d) => d.id === deviceId);

  const choose = (id: string) => {
    setPicked(id);
    setLastDeviceId(id);
  };

  return (
    <Screen withTabBar title="History" subtitle="How your garden has been doing" testID="history-screen">
      {devices.isPending ? (
        <View style={{ gap: t.space.lg }}>
          <Skeleton height={36} />
          <Skeleton height={300} radius={t.radius.lg} />
        </View>
      ) : !device ? (
        <EmptyState
          icon={Sprout}
          title="No history yet"
          message="Add a device and its readings will show up here."
          actionLabel="Add device"
          onAction={() => router.push('/onboarding')}
        />
      ) : (
        <View style={{ gap: t.space.lg }}>
          {list.length > 1 ? (
            <ChipGroup scrollable options={list.map((d) => ({ value: d.id, label: d.name }))} value={device.id} onChange={choose} />
          ) : null}
          <DeviceHistory device={device} />
        </View>
      )}
    </Screen>
  );
}

function DeviceHistory({ device }: { device: DevicePublic }) {
  const t = useTheme();
  const units = usePrefs((s) => s.units);
  const [range, setRange] = useState<RangeKey>('24h');
  const [metric, setMetric] = useState<Metric>('soil');
  const now = useNow(60_000);
  const r = computeRange(range, now);
  const fmt = timeFormatters(range);

  const readings = useQuery({
    queryKey: qk.readings(device.id, `${range}:${r.to}`),
    queryFn: () => api.devices.readings(device.id, { from: r.fromIso, to: r.toIso, tz: deviceTimeZone() }),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });
  const events = useQuery({
    queryKey: qk.pumpEvents(device.id, `${range}:${r.to}`),
    queryFn: () => api.devices.pumpEvents(device.id, { from: r.fromIso, to: r.toIso }),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const toF = (c: number) => (units === 'f' ? c * 1.8 + 32 : c);
  const points: ChartPoint[] = useMemo(
    () =>
      (readings.data?.points ?? []).map((p) => ({
        t: Date.parse(p.ts),
        v: metric === 'soil' ? p.soilMoisture : metric === 'humidity' ? p.humidity : p.temperature === null ? null : toF(p.temperature),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readings.data, metric, units],
  );
  const bands = useMemo(
    () => (events.data ?? []).map((e) => ({ start: Date.parse(e.startedAt), end: e.endedAt ? Date.parse(e.endedAt) : now })),
    [events.data, now],
  );

  const s = device.desired.settings;
  const cfg = {
    soil: {
      color: t.colors.water,
      unit: '%',
      clamp: [0, 100] as [number, number],
      refLines: [
        { value: s.moistureLow, label: `Water below ${s.moistureLow}%`, color: t.colors.warning },
        { value: s.moistureHigh, label: `Stop above ${s.moistureHigh}%`, color: t.colors.accent },
      ],
      label: 'Soil moisture',
    },
    temp: { color: t.colors.sun, unit: units === 'f' ? '°F' : '°C', clamp: undefined, refLines: [], label: 'Temperature' },
    humidity: { color: t.colors.humidity, unit: '%', clamp: [0, 100] as [number, number], refLines: [], label: 'Air humidity' },
  }[metric];

  const stats = readings.data?.stats;
  const tempAvg = formatTemp(stats?.temperatureAvg, units);

  return (
    <View style={{ gap: t.space.lg }}>
      <ChipGroup options={RANGES.map((x) => ({ value: x.key, label: x.label }))} value={range} onChange={setRange} />

      <Card padding={t.space.lg}>
        <View style={{ gap: t.space.md }}>
          <SegmentedControl
            options={[
              { value: 'soil', label: 'Soil', icon: Droplets },
              { value: 'temp', label: 'Temp', icon: Thermometer },
              { value: 'humidity', label: 'Air', icon: Waves },
            ]}
            value={metric}
            onChange={setMetric}
          />
          {readings.isError && !readings.data ? (
            <Banner tone="danger" title="Couldn't load history" message={errorMessage(readings.error)} />
          ) : readings.isPending ? (
            <Skeleton height={260} />
          ) : points.every((p) => p.v === null) ? (
            <EmptyState compact icon={ChartSpline} title="No readings in this period" message="Try a longer range, or check back once the device has been online for a while." />
          ) : (
            <LineChart
              testID="history-chart"
              points={points}
              bands={metric === 'soil' ? bands : []}
              refLines={cfg.refLines}
              color={cfg.color}
              unit={cfg.unit}
              clamp={cfg.clamp}
              formatX={fmt.axis}
              formatTooltipX={fmt.tooltip}
              formatY={(v) => (metric === 'temp' ? v.toFixed(1) : v.toFixed(0))}
              accessibilityLabel={`${cfg.label} over the last ${RANGES.find((x) => x.key === range)!.label}`}
            />
          )}
          {metric === 'soil' && bands.length ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: t.colors.waterSoft }} />
              <Text variant="caption" tone="textSecondary">
                Shaded = pump running
              </Text>
            </View>
          ) : null}
        </View>
      </Card>

      <View style={{ flexDirection: 'row', gap: t.space.sm }}>
        <MetricTile icon={Droplets} label="Avg soil" value={formatPct(stats?.soilMoistureAvg)} unit="%" color={t.colors.water} background={t.colors.waterSoft} />
        <MetricTile icon={Thermometer} label="Avg temp" value={tempAvg.value} unit={tempAvg.unit} color={t.colors.sun} background={t.colors.sunSoft} />
        <MetricTile icon={Clock} label="Watering" value={stats ? durationText(stats.pumpOnSec) : '—'} color={t.colors.accent} background={t.colors.accentSoft} />
      </View>

      <ListGroup title={`Watering sessions (${events.data?.length ?? 0})`}>
        {(events.data ?? []).slice(0, 8).map((e) => (
          <ListRow
            key={e.id}
            icon={Droplets}
            iconColor={t.colors.water}
            title={`${fmt.tooltip(Date.parse(e.startedAt))}`}
            subtitle={`${e.source === 'manual' ? 'Manual' : 'Automatic'} · ${e.durationSec !== null ? durationText(e.durationSec) : 'running'}${e.stopReason ? ` · stopped: ${e.stopReason.replace('_', ' ')}` : ''}`}
          />
        ))}
        {!events.data?.length ? (
          <ListRow title="No watering in this period" subtitle={`Last reading ${relativeTime(device.lastSeenAt, now)}`} />
        ) : null}
      </ListGroup>
    </View>
  );
}
