import { SETTINGS_LIMITS as L, type DevicePublic, type DeviceSettings } from '@xeno/shared';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  CheckCircle2,
  CloudRain,
  Gauge as GaugeIcon,
  Lightbulb,
  Pencil,
  RefreshCcw,
  Timer,
  Trash2,
  Wifi,
} from 'lucide-react-native';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/design';
import {
  Badge,
  Banner,
  Button,
  Card,
  IconButton,
  ListGroup,
  ListRow,
  RangeSlider,
  Screen,
  Sheet,
  SkeletonCard,
  Slider,
  Text,
  TextField,
  Toggle,
  toast,
} from '@/ui';
import { FirmwareRow } from './FirmwareRow';
import { useDevice } from './hooks';
import { useDeviceMutations } from './mutations';
import { diffSettings, formatSeconds, validateSettings } from './settingsForm';

export function DeviceSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const device = useDevice(id);
  const back = <IconButton icon={ArrowLeft} accessibilityLabel="Back" onPress={() => router.back()} />;
  if (!device.data) {
    return (
      <Screen headerLeft={back} title="Settings">
        <SkeletonCard height={400} />
      </Screen>
    );
  }
  // Remount (reset the draft) only when the saved settings themselves change — not when a pump
  // command bumps the desired version.
  return <SettingsForm key={JSON.stringify(device.data.desired.settings)} device={device.data} back={back} />;
}

function SettingsForm({ device, back }: { device: DevicePublic; back: React.ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const m = useDeviceMutations(device.id);
  const base = device.desired.settings;
  const [draft, setDraft] = useState<DeviceSettings>(base);
  const [renameOpen, setRenameOpen] = useState(false);
  const [calibrateOpen, setCalibrateOpen] = useState(false);
  const patch = diffSettings(base, draft);
  const dirty = Object.keys(patch).length > 0;
  const error = validateSettings(draft);
  const set = <K extends keyof DeviceSettings>(k: K, v: DeviceSettings[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = () =>
    m.updateSettings.mutate(patch, {
      onSuccess: () => toast.success('Saved', device.online ? 'Sending to your device…' : 'Will apply when the device reconnects'),
    });

  const confirmRemove = () =>
    Alert.alert(
      `Remove ${device.name}?`,
      'Its history is kept for 30 days. You can add it again at any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () =>
            m.remove.mutate(undefined, {
              onSuccess: () => {
                toast.success('Device removed');
                router.dismissAll?.();
                router.replace('/');
              },
            }),
        },
      ],
    );

  return (
    <View style={{ flex: 1 }}>
      <Screen headerLeft={back} title="Settings" subtitle={device.name} keyboard testID="device-settings">
        <View style={{ gap: t.space.xl }}>
          <SyncStatus device={device} />

          <Card>
            <View style={{ gap: t.space.lg }}>
              <SectionTitle icon={GaugeIcon} title="Moisture targets" />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Value label="Start watering below" value={`${draft.moistureLow}%`} color={t.colors.warning} />
                <Value label="Stop above" value={`${draft.moistureHigh}%`} color={t.colors.water} align="right" />
              </View>
              <RangeSlider
                min={5}
                max={95}
                step={1}
                low={draft.moistureLow}
                high={draft.moistureHigh}
                minGap={L.moistureMinGap}
                onChange={(lo, hi) => setDraft((d) => ({ ...d, moistureLow: lo, moistureHigh: hi }))}
                accessibilityLabel="Moisture target range"
                testID="moisture-range"
              />
              <Text variant="caption" tone="textSecondary">
                Most vegetables like 30–60%. Succulents prefer 10–25%. The gap between the two numbers stops the pump from flicking on and off.
              </Text>
            </View>
          </Card>

          <Card>
            <View style={{ gap: t.space.lg }}>
              <SectionTitle icon={Timer} title="Safety" />
              <Value label="Longest single watering" value={formatSeconds(draft.maxPumpRunSec)} />
              <Slider
                min={L.maxPumpRunSec.min}
                max={L.maxPumpRunSec.max}
                step={30}
                value={draft.maxPumpRunSec}
                onChange={(v) => set('maxPumpRunSec', v)}
                accessibilityLabel="Maximum pump run time"
                testID="max-run"
              />
              <Value label="Rest between waterings" value={formatSeconds(draft.cooldownSec)} />
              <Slider
                min={L.cooldownSec.min}
                max={L.cooldownSec.max}
                step={30}
                value={draft.cooldownSec}
                onChange={(v) => set('cooldownSec', v)}
                accessibilityLabel="Cooldown between waterings"
              />
              <ListRow
                icon={CloudRain}
                iconColor={t.colors.rain}
                title="Skip watering when it rains"
                subtitle="Uses the rain sensor"
                right={<Toggle value={draft.rainLockout} onChange={(v) => set('rainLockout', v)} accessibilityLabel="Rain lockout" testID="rain-toggle" />}
              />
            </View>
          </Card>

          <Card>
            <View style={{ gap: t.space.lg }}>
              <SectionTitle icon={Lightbulb} title="Alerts & data" />
              <Value label="Heat warning at" value={`${draft.highTempC}°C`} />
              <Slider
                min={L.highTempC.min}
                max={L.highTempC.max}
                step={1}
                value={draft.highTempC}
                onChange={(v) => set('highTempC', v)}
                accessibilityLabel="High temperature alert"
              />
              <Value label="Send readings every" value={formatSeconds(draft.telemetryIntervalSec)} />
              <Slider
                min={L.telemetryIntervalSec.min}
                max={60}
                step={1}
                value={Math.min(60, draft.telemetryIntervalSec)}
                onChange={(v) => set('telemetryIntervalSec', v)}
                accessibilityLabel="Telemetry interval"
              />
            </View>
          </Card>

          <ListGroup title="Device">
            <ListRow icon={Pencil} title="Rename" value={device.name} onPress={() => setRenameOpen(true)} testID="rename-row" />
            <ListRow
              icon={Wifi}
              title="Change WiFi network"
              subtitle="Moving it or got a new router? Re-pair over Bluetooth."
              onPress={() => router.push({ pathname: '/onboarding', params: { mode: 'wifi', deviceId: device.id } })}
            />
            <ListRow icon={RefreshCcw} title="Calibrate soil sensor" subtitle="Improves accuracy (takes 1 minute)" onPress={() => setCalibrateOpen(true)} />
            <ListRow
              icon={Lightbulb}
              title="Identify device"
              subtitle="Blinks its light so you can find it"
              onPress={() => m.command.mutate('identify', { onSuccess: () => toast.info('Look for the blinking light') })}
            />
            <FirmwareRow deviceId={device.id} online={device.online} />
          </ListGroup>

          <ListGroup>
            <ListRow icon={Trash2} title="Remove device" destructive onPress={confirmRemove} testID="remove-device" />
          </ListGroup>
          {dirty ? <View style={{ height: 80 }} /> : null}
        </View>
      </Screen>

      {dirty ? (
        <Animated.View
          entering={FadeInDown.springify()}
          exiting={FadeOutDown}
          style={{
            position: 'absolute',
            left: t.space.gutter,
            right: t.space.gutter,
            bottom: insets.bottom + t.space.md,
            gap: t.space.sm,
          }}
        >
          {error ? <Banner tone="danger" title={error} /> : null}
          <View style={{ flexDirection: 'row', gap: t.space.sm }}>
            <Button title="Reset" variant="secondary" onPress={() => setDraft(base)} style={{ flex: 1 }} />
            <Button title="Save changes" onPress={save} loading={m.updateSettings.isPending} disabled={!!error} style={{ flex: 2 }} testID="save-settings" />
          </View>
        </Animated.View>
      ) : null}

      <RenameSheet
        visible={renameOpen}
        initial={device.name}
        onClose={() => setRenameOpen(false)}
        onSave={(name) => m.rename.mutate(name, { onSuccess: () => setRenameOpen(false) })}
        saving={m.rename.isPending}
      />
      <CalibrateSheet
        visible={calibrateOpen}
        onClose={() => setCalibrateOpen(false)}
        online={device.online}
        send={(type) => m.command.mutateAsync(type)}
      />
    </View>
  );
}

function SyncStatus({ device }: { device: DevicePublic }) {
  const t = useTheme();
  if (!device.online) {
    return <Banner tone="offline" title="Device offline" message="Changes are saved and applied as soon as it reconnects." />;
  }
  return device.syncPending ? (
    <Badge label="Syncing to device…" color={t.colors.info} background={t.colors.waterSoft} dot pulse />
  ) : (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <CheckCircle2 size={16} color={t.colors.accent} />
      <Text variant="caption" tone="accent">
        Device is up to date
      </Text>
    </View>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: typeof Timer; title: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
      <Icon size={18} color={t.colors.accent} />
      <Text variant="heading">{title}</Text>
    </View>
  );
}

function Value({ label, value, color, align }: { label: string; value: string; color?: string; align?: 'right' }) {
  return (
    <View style={{ alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <Text variant="caption" tone="textSecondary">
        {label}
      </Text>
      <Text variant="metric" color={color} tabular>
        {value}
      </Text>
    </View>
  );
}

function RenameSheet({
  visible,
  initial,
  onClose,
  onSave,
  saving,
}: {
  visible: boolean;
  initial: string;
  onClose: () => void;
  onSave: (name: string) => void;
  saving: boolean;
}) {
  const t = useTheme();
  const [name, setName] = useState(initial);
  const trimmed = name.trim();
  return (
    <Sheet visible={visible} onClose={onClose} title="Rename device">
      <View style={{ gap: t.space.lg }}>
        <TextField label="Name" value={name} onChangeText={setName} maxLength={40} autoFocus testID="rename-input" />
        <Button title="Save" onPress={() => onSave(trimmed)} disabled={!trimmed || trimmed === initial} loading={saving} />
      </View>
    </Sheet>
  );
}

function CalibrateSheet({
  visible,
  onClose,
  online,
  send,
}: {
  visible: boolean;
  onClose: () => void;
  online: boolean;
  send: (type: 'calibrate_dry' | 'calibrate_wet') => Promise<unknown>;
}) {
  const t = useTheme();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [busy, setBusy] = useState(false);
  const run = async (type: 'calibrate_dry' | 'calibrate_wet', next: 1 | 2) => {
    setBusy(true);
    try {
      await send(type);
      setStep(next);
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setStep(0);
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={close} title="Calibrate soil sensor">
      {!online ? (
        <Banner tone="offline" title="The device must be online to calibrate" />
      ) : step === 0 ? (
        <View style={{ gap: t.space.lg }}>
          <Text tone="textSecondary">Step 1 of 2 — Pull the sensor out of the soil, wipe it dry and hold it in the air.</Text>
          <Button title="It's in the air — measure dry" loading={busy} onPress={() => void run('calibrate_dry', 1)} />
        </View>
      ) : step === 1 ? (
        <View style={{ gap: t.space.lg }}>
          <Text tone="textSecondary">Step 2 of 2 — Put the sensor in a glass of water up to the line.</Text>
          <Button title="It's in water — measure wet" loading={busy} onPress={() => void run('calibrate_wet', 2)} />
        </View>
      ) : (
        <View style={{ gap: t.space.lg }}>
          <Banner tone="info" icon={CheckCircle2} title="Calibrated" message="Put the sensor back in the soil. Readings are now tuned to your sensor." />
          <Button title="Done" onPress={close} />
        </View>
      )}
    </Sheet>
  );
}
