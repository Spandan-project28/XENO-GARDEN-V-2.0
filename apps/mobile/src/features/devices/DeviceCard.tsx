import type { DevicePublic } from '@xeno/shared';
import { CloudRain, Droplets, Square, Sun, Thermometer } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/design';
import { formatPct, formatTemp, moistureState, pumpReasonText, relativeTime } from '@/lib/format';
import { usePrefs } from '@/lib/prefs';
import { useNow } from '@/lib/useNow';
import { Badge, Button, Card, Gauge, PressableScale, Text, Toggle } from '@/ui';
import { pumpState } from './hooks';
import { useDeviceMutations } from './mutations';
import { allowedDurations, derivePumpUi, type PendingCommand } from './pumpUi';

export function DeviceStatusBadge({ device, now }: { device: DevicePublic; now: number }) {
  const t = useTheme();
  const pump = pumpState(device);
  if (!device.online) {
    return (
      <Badge
        label={`Offline · ${relativeTime(device.lastSeenAt, now)}`}
        color={t.colors.textSecondary}
        dot
      />
    );
  }
  if (pump.on)
    return (
      <Badge label="Watering" color={t.colors.water} background={t.colors.waterSoft} dot pulse />
    );
  return (
    <Badge label="Online" color={t.colors.accent} background={t.colors.accentSoft} dot pulse />
  );
}

export function DeviceCard({
  device,
  now,
  onPress,
}: {
  device: DevicePublic;
  now: number;
  onPress: () => void;
}) {
  const t = useTheme();
  const units = usePrefs((s) => s.units);
  const latest = device.latest;
  const s = device.desired.settings;
  const soil = latest?.soilMoisture ?? null;
  const state = moistureState(soil, s.moistureLow, s.moistureHigh);
  const gaugeColor = state === 'dry' ? t.colors.warning : t.colors.water;
  const temp = formatTemp(latest?.temperature, units);
  const pump = pumpState(device);

  return (
    <Card padding={t.space.xl}>
      {/* The readings open the device; the action buttons sit outside, so no button is nested in another. */}
      <PressableScale
        onPress={onPress}
        accessibilityLabel={`${device.name}. Soil moisture ${formatPct(soil)} percent. ${device.online ? 'Online' : 'Offline'}.`}
        testID={`device-card-${device.id}`}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: t.space.md,
          }}
        >
          <View style={{ flex: 1, gap: 6 }}>
            <Text variant="heading" numberOfLines={1}>
              {device.name}
            </Text>
            <DeviceStatusBadge device={device} now={now} />
          </View>
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.space.lg,
            marginVertical: t.space.lg,
          }}
        >
          <Gauge
            value={soil}
            size={112}
            stroke={10}
            color={gaugeColor}
            band={{ from: s.moistureLow, to: s.moistureHigh }}
          />
          <View style={{ flex: 1, gap: t.space.xs }}>
            <Text variant="overline" tone="textSecondary">
              Soil moisture
            </Text>
            <Text variant="subheading" numberOfLines={2}>
              {state === 'dry'
                ? 'Thirsty'
                : state === 'wet'
                  ? 'Very wet'
                  : state === 'ok'
                    ? 'Happy'
                    : 'No reading'}
            </Text>
            <Text variant="caption" tone="textSecondary" numberOfLines={2}>
              {pumpReasonText(pump.reason)}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: t.space.sm }}>
          <Pill
            icon={Thermometer}
            color={t.colors.sun}
            bg={t.colors.sunSoft}
            text={`${temp.value}${temp.unit}`}
            label="Temperature"
          />
          <Pill
            icon={Droplets}
            color={t.colors.humidity}
            bg={t.colors.humiditySoft}
            text={`${formatPct(latest?.humidity)}%`}
            label="Humidity"
          />
          <Pill
            icon={latest?.rain ? CloudRain : Sun}
            color={t.colors.rain}
            bg={t.colors.rainSoft}
            text={latest ? (latest.rain ? 'Rain' : 'Dry') : '—'}
            label="Rain"
          />
        </View>
      </PressableScale>

      <QuickActions device={device} />
    </Card>
  );
}

/** The two things people do every day, right on the card: water now, and auto on/off. */
function QuickActions({ device }: { device: DevicePublic }) {
  const t = useTheme();
  const { pump, setMode } = useDeviceMutations(device.id);
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const now = useNow(1000);
  const ui = derivePumpUi(device, pending, now);
  const running = ui.state === 'running' || ui.state === 'stopping';
  const busy = ui.state === 'starting' || ui.state === 'stopping' || pump.isPending;
  const auto = device.desired.mode === 'auto';
  const durations = allowedDurations(device.desired.settings.maxPumpRunSec);
  const duration = durations[1] ?? durations[0]!;

  const water = () => {
    if (busy || !device.online) return;
    const action = running ? 'OFF' : 'ON';
    pump.mutate(action === 'ON' ? { action, durationSec: duration } : { action }, {
      onSuccess: (r) =>
        setPending({ action, version: r.device.desired.version, since: Date.now() }),
    });
  };

  const title = !device.online
    ? 'Offline'
    : ui.state === 'starting'
      ? 'Starting…'
      : ui.state === 'stopping'
        ? 'Stopping…'
        : running
          ? 'Stop watering'
          : 'Water now';

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, marginTop: t.space.lg }}
    >
      <Button
        title={title}
        icon={running ? Square : Droplets}
        variant={running ? 'secondary' : 'primary'}
        size="md"
        onPress={water}
        loading={pump.isPending}
        disabled={!device.online}
        style={{ flex: 1 }}
        accessibilityHint={
          running ? 'Stops the pump' : `Waters for ${Math.round(duration / 60)} minutes`
        }
        testID={`card-water-${device.id}`}
      />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space.sm,
          height: 44,
          paddingHorizontal: t.space.md,
          borderRadius: t.radius.pill,
          backgroundColor: t.colors.surfaceAlt,
        }}
      >
        <Text variant="label" tone={auto ? 'accent' : 'textSecondary'}>
          Auto
        </Text>
        <Toggle
          value={auto}
          onChange={(v) => setMode.mutate(v ? 'auto' : 'manual')}
          accessibilityLabel="Automatic watering"
          testID={`card-auto-${device.id}`}
        />
      </View>
    </View>
  );
}

function Pill({
  icon: Icon,
  color,
  bg,
  text,
  label,
}: {
  icon: typeof Sun;
  color: string;
  bg: string;
  text: string;
  label: string;
}) {
  const t = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label} ${text}`}
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height: 36,
        borderRadius: t.radius.pill,
        backgroundColor: bg,
      }}
    >
      <Icon size={15} color={color} strokeWidth={2.2} />
      <Text variant="label" tabular>
        {text}
      </Text>
    </View>
  );
}
