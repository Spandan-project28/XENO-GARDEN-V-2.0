import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Bluetooth,
  CheckCircle2,
  Lock,
  PartyPopper,
  Plug,
  RefreshCw,
  Router,
  Wifi,
  X,
} from 'lucide-react-native';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';
import { BrandMark } from '@/components/BrandMark';
import { useTheme } from '@/design';
import { api } from '@/lib/api';
import { createTransport } from '@/lib/ble';
import { upsertDevice } from '@/lib/deviceCache';
import { qk } from '@/lib/queryKeys';
import { Banner, Button, Card, Chip, IconButton, PressableScale, Screen, Text, TextField } from '@/ui';
import { ProvisioningFlow, type FlowState, type Step } from './flow';
import { JoinTimeline, NetworkRow, Radar, SignalIcon, StepProgress } from './parts';

const STEP_INDEX: Record<Step, number> = {
  intro: 0,
  scanning: 1,
  connecting: 2,
  wifi: 3,
  password: 3,
  joining: 4,
  naming: 5,
  done: 5,
};

const NAME_IDEAS = ['Balcony', 'Backyard', 'Herbs', 'Tomatoes', 'Indoor plants', 'Greenhouse'];

export function OnboardingScreen({ flowFactory }: { flowFactory?: () => ProvisioningFlow } = {}) {
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode = params.mode === 'wifi' ? 'wifi' : 'add';
  const qc = useQueryClient();
  const [flow] = useState(
    () =>
      flowFactory?.() ??
      new ProvisioningFlow(
        {
          transport: createTransport(),
          claim: (hardwareId, claimCode) => api.devices.claim({ hardwareId, claimCode }),
          getDevice: (id) => api.devices.get(id),
          rename: (id, name) => api.devices.update(id, { name }),
        },
        mode,
      ),
  );
  useEffect(() => () => void flow.dispose(), [flow]);
  const s = useSyncExternalStore(flow.subscribe, flow.getState);

  // Keep the rest of the app in sync as soon as the device exists in the account.
  useEffect(() => {
    if (s.device) upsertDevice(qc, s.device);
    if (s.step === 'done') void qc.invalidateQueries({ queryKey: qk.devices });
  }, [s.device, s.step, qc]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <Screen
      keyboard
      headerRight={s.step !== 'done' ? <IconButton icon={X} accessibilityLabel="Cancel setup" onPress={close} /> : undefined}
      title={mode === 'wifi' ? 'Change WiFi' : 'Add a device'}
      testID="onboarding"
    >
      <StepProgress index={STEP_INDEX[s.step]} total={6} />
      {s.error ? (
        <Animated.View entering={FadeInDown} style={{ gap: 12, marginBottom: 20 }}>
          <Banner tone="danger" title={s.error.title} message={s.error.message} />
          <Button title="Try again" onPress={() => flow.dismissError()} testID="error-retry" />
        </Animated.View>
      ) : null}
      <StepView flow={flow} s={s} mode={mode} close={close} />
    </Screen>
  );
}

function StepView({ flow, s, mode, close }: { flow: ProvisioningFlow; s: FlowState; mode: 'add' | 'wifi'; close: () => void }) {
  switch (s.step) {
    case 'intro':
      return <Intro onStart={() => void flow.startScan()} busy={s.busy} mode={mode} />;
    case 'scanning':
      return <Scanning flow={flow} s={s} />;
    case 'connecting':
      return <Connecting s={s} />;
    case 'wifi':
      return <WifiList flow={flow} s={s} />;
    case 'password':
      return <Password flow={flow} s={s} />;
    case 'joining':
      return <Joining s={s} />;
    case 'naming':
      return <Naming flow={flow} s={s} />;
    case 'done':
      return <Done s={s} mode={mode} close={close} />;
  }
}

function Intro({ onStart, busy, mode }: { onStart: () => void; busy: boolean; mode: 'add' | 'wifi' }) {
  const t = useTheme();
  const items =
    mode === 'wifi'
      ? [
          { icon: Plug, text: 'Hold the button on your device for 5 seconds until the light blinks blue.' },
          { icon: Bluetooth, text: 'Keep your phone within a few steps of it, with Bluetooth on.' },
          { icon: Router, text: 'Have the new WiFi password ready (2.4 GHz network).' },
        ]
      : [
          { icon: Plug, text: 'Plug in your Xeno Garden device. The light blinks blue when it’s ready to pair.' },
          { icon: Bluetooth, text: 'Keep your phone close, with Bluetooth on.' },
          { icon: Router, text: 'Have your WiFi password ready. The device needs a 2.4 GHz network (most routers have one).' },
        ];
  return (
    <Animated.View entering={FadeIn} style={{ gap: t.space.xl }}>
      <View style={{ alignItems: 'center' }}>
        <BrandMark size={120} />
      </View>
      <Text variant="body" tone="textSecondary" align="center">
        No cables to your computer, no IP addresses. Your phone hands the device everything it needs over Bluetooth.
      </Text>
      <View style={{ gap: t.space.md }}>
        {items.map(({ icon: Icon, text }, i) => (
          <Card key={i} variant="glass" padding={t.space.md}>
            <View style={{ flexDirection: 'row', gap: t.space.md, alignItems: 'center' }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.accentSoft }}>
                <Icon size={18} color={t.colors.accent} />
              </View>
              <Text variant="body" style={{ flex: 1 }}>
                {text}
              </Text>
            </View>
          </Card>
        ))}
      </View>
      <Button title="Find my device" icon={Bluetooth} onPress={onStart} loading={busy} fullWidth testID="start-scan" />
    </Animated.View>
  );
}

function Scanning({ flow, s }: { flow: ProvisioningFlow; s: FlowState }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.space.xl }}>
      <Radar />
      <Text variant="heading" align="center">
        {s.devices.length ? 'Found nearby' : 'Looking for devices…'}
      </Text>
      <View style={{ gap: t.space.sm }}>
        {s.devices.map((d) => (
          <Animated.View key={d.id} entering={FadeInDown.springify()}>
            <PressableScale
              onPress={() => void flow.chooseDevice(d)}
              accessibilityLabel={`Set up ${d.name}`}
              testID={`found-${d.id}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.space.md,
                padding: t.space.lg,
                borderRadius: t.radius.lg,
                backgroundColor: t.colors.surface,
                borderWidth: 1,
                borderColor: t.colors.borderStrong,
              }}
            >
              <SignalIcon rssi={d.rssi} color={t.colors.accent} />
              <View style={{ flex: 1 }}>
                <Text variant="subheading">{d.name}</Text>
                <Text variant="caption" tone="textSecondary">
                  {d.simulated ? 'Demo device (simulated)' : 'Tap to set up'}
                </Text>
              </View>
            </PressableScale>
          </Animated.View>
        ))}
      </View>
      {s.scanTimedOut && !s.devices.length ? (
        <Card variant="glass">
          <View style={{ gap: t.space.sm }}>
            <Text variant="subheading">Can’t find it?</Text>
            <Text variant="caption" tone="textSecondary">
              • Make sure the device is powered and its light blinks blue.{'\n'}• Hold its button for 5 seconds to restart pairing mode.{'\n'}• Keep your phone within 2–3 metres.
            </Text>
            <Button title="Scan again" icon={RefreshCw} variant="secondary" size="md" onPress={() => void flow.startScan()} />
          </View>
        </Card>
      ) : null}
    </View>
  );
}

function Connecting({ s }: { s: FlowState }) {
  const t = useTheme();
  const stages: { key: NonNullable<FlowState['connectStage']>; label: string }[] = [
    { key: 'connecting', label: 'Connecting over Bluetooth' },
    { key: 'claiming', label: 'Linking it to your account' },
    { key: 'scanning_wifi', label: 'Looking for WiFi networks' },
  ];
  const idx = stages.findIndex((x) => x.key === s.connectStage);
  return (
    <View style={{ gap: t.space.xl, alignItems: 'center' }}>
      <Radar size={160} />
      <View style={{ gap: t.space.md, alignSelf: 'stretch' }}>
        {stages.map((st, i) => (
          <View key={st.key} style={{ flexDirection: 'row', gap: t.space.md, alignItems: 'center', opacity: i > idx ? 0.4 : 1 }}>
            {i < idx ? <CheckCircle2 size={20} color={t.colors.accent} /> : <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: i === idx ? t.colors.accent : t.colors.borderStrong }} />}
            <Text variant="subheading">{st.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function WifiList({ flow, s }: { flow: ProvisioningFlow; s: FlowState }) {
  const t = useTheme();
  const [hidden, setHidden] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  return (
    <View style={{ gap: t.space.lg }}>
      <Text variant="heading">Which WiFi should it use?</Text>
      <Text variant="caption" tone="textSecondary">
        These are the networks your device can see. Only 2.4 GHz networks appear. If yours is missing, check that the router has 2.4 GHz enabled.
      </Text>
      <View style={{ gap: t.space.sm }}>
        {s.networks.map((n) => (
          <NetworkRow key={n.ssid} network={n} onPress={() => flow.chooseNetwork(n)} />
        ))}
      </View>
      {showHidden ? (
        <View style={{ gap: t.space.sm }}>
          <TextField label="Network name" icon={Wifi} value={hidden} onChangeText={setHidden} autoCapitalize="none" testID="hidden-ssid" />
          <Button title="Continue" size="md" disabled={!hidden.trim()} onPress={() => flow.chooseHiddenNetwork(hidden)} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: t.space.sm }}>
          <Button title="Scan again" icon={RefreshCw} variant="secondary" size="md" loading={s.busy} onPress={() => void flow.rescanWifi()} />
          <Button title="Hidden network" variant="ghost" size="md" onPress={() => setShowHidden(true)} />
        </View>
      )}
    </View>
  );
}

function Password({ flow, s }: { flow: ProvisioningFlow; s: FlowState }) {
  const t = useTheme();
  const [pw, setPw] = useState('');
  const n = s.network!;
  return (
    <View style={{ gap: t.space.lg }}>
      <Text variant="heading">Password for “{n.ssid}”</Text>
      <Text variant="caption" tone="textSecondary">
        Sent straight to your device over Bluetooth. It’s stored only on the device, never on our servers.
      </Text>
      <TextField label="WiFi password" icon={Lock} secure value={pw} onChangeText={setPw} autoCapitalize="none" returnKeyType="go" onSubmitEditing={() => void flow.join(pw)} testID="wifi-password" />
      <Button title="Connect" icon={Wifi} onPress={() => void flow.join(pw)} disabled={n.secure && pw.length === 0} fullWidth testID="wifi-connect" />
      <Button title="Choose another network" variant="ghost" onPress={() => flow.backToNetworks()} />
    </View>
  );
}

function Joining({ s }: { s: FlowState }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.space.xl }}>
      <Text variant="heading">Connecting your device</Text>
      <Card>
        <JoinTimeline progress={s.progress} failed={!!s.error} />
      </Card>
      {!s.error ? (
        <Text variant="caption" tone="textSecondary" align="center">
          This usually takes 10–20 seconds.
        </Text>
      ) : null}
    </View>
  );
}

function Naming({ flow, s }: { flow: ProvisioningFlow; s: FlowState }) {
  const t = useTheme();
  const [name, setName] = useState(s.device?.name ?? '');
  return (
    <View style={{ gap: t.space.lg }}>
      <Animated.View entering={ZoomIn.springify()} style={{ alignItems: 'center' }}>
        <CheckCircle2 size={56} color={t.colors.accent} />
      </Animated.View>
      <Text variant="heading" align="center">
        It’s online! What should we call it?
      </Text>
      <TextField label="Name" value={name} onChangeText={setName} maxLength={40} testID="device-name" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
        {NAME_IDEAS.map((idea) => (
          <Chip key={idea} label={idea} selected={name === idea} onPress={() => setName(idea)} />
        ))}
      </View>
      <Button title="Finish" onPress={() => void flow.finish(name)} loading={s.busy} disabled={!name.trim()} fullWidth testID="finish" />
    </View>
  );
}

function Done({ s, mode, close }: { s: FlowState; mode: 'add' | 'wifi'; close: () => void }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.space.xl, alignItems: 'center', paddingTop: t.space.xxl }}>
      <Animated.View entering={ZoomIn.springify().damping(12)}>
        <View style={{ width: 120, height: 120, borderRadius: 60, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <PartyPopper size={56} color={t.colors.accent} />
        </View>
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(200)} style={{ gap: t.space.sm }}>
        <Text variant="title" align="center">
          {mode === 'wifi' ? 'WiFi updated' : `${s.device?.name ?? 'Your device'} is ready`}
        </Text>
        <Text variant="body" tone="textSecondary" align="center">
          {mode === 'wifi'
            ? 'Your device is back online on the new network.'
            : 'It’s already watching the soil and will water automatically. Check in from anywhere, on any network.'}
        </Text>
      </Animated.View>
      <View style={{ alignSelf: 'stretch', gap: t.space.sm }}>
        {s.device ? (
          <Button
            title="Open device"
            onPress={() => {
              close();
              router.push(`/device/${s.device!.id}`);
            }}
            fullWidth
            testID="open-device"
          />
        ) : null}
        <Button title="Back to garden" variant="secondary" onPress={close} fullWidth />
      </View>
    </View>
  );
}
