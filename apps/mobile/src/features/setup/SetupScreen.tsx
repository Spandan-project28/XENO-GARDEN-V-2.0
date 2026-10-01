import type { WifiNetwork } from '@xeno/shared';
import { router } from 'expo-router';
import { AlertTriangle, Check, Lock, PartyPopper, RefreshCw, Sprout, Wifi, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition, ZoomIn } from 'react-native-reanimated';
import { useTheme } from '@/design';
import { SignalIcon, Radar } from '@/features/onboarding/parts';
import { Banner, Button, Card, Chip, IconButton, Screen, Text, TextField } from '@/ui';
import { isBusy, isFinished, type AutoSetupState, type SetupItem, type WifiRequest } from './autoSetup';
import { resetAutoSetup, useAutoSetup } from './controller';

/** Shown after a while if nothing turns up. */
const HINT_AFTER_MS = 15_000;

export function SetupScreen() {
  const t = useTheme();
  const [setup, s] = useAutoSetup();
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    if (setup.getState().phase === 'idle') void setup.discover();
    const timer = setTimeout(() => setShowHint(true), HINT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [setup]);

  const running = s.phase === 'running';
  const pending = s.items.filter((i) => i.status === 'found');
  const done = s.items.filter((i) => i.status === 'online' || i.status === 'waiting');
  const allDone = s.phase === 'done' && s.items.length > 0 && s.items.every(isFinished);

  const close = () => {
    if (!running) resetAutoSetup();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <Screen
      keyboard
      title="Add devices"
      headerRight={<IconButton icon={X} accessibilityLabel="Close" onPress={close} testID="setup-close" />}
      testID="setup-screen"
    >
      <View style={{ gap: t.space.xl }}>
        <Hero state={s} allDone={allDone} doneCount={done.length} showHint={showHint} />

        {s.error ? (
          <Animated.View entering={FadeInDown} style={{ gap: t.space.md }}>
            <Banner tone="warning" title={s.error.title} message={s.error.message} />
            <Button title="Try again" icon={RefreshCw} variant="secondary" onPress={() => void setup.discover()} testID="setup-retry-scan" />
          </Animated.View>
        ) : null}

        {s.wifiRequest ? (
          <WifiPrompt
            key={`${s.wifiRequest.itemId}-${s.wifiRequest.reason}`}
            request={s.wifiRequest}
            onSubmit={(ssid, pw) => setup.provideWifi(ssid, pw)}
            onCancel={() => setup.cancelWifi()}
          />
        ) : null}

        {s.items.length ? (
          <View style={{ gap: t.space.sm }}>
            {s.items.map((item, i) => (
              <Animated.View key={item.id} entering={FadeInDown.delay(i * 60)} layout={LinearTransition}>
                <DeviceRow item={item} onRetry={() => void setup.retry(item.id)} disabled={running} />
              </Animated.View>
            ))}
          </View>
        ) : null}

        <View style={{ gap: t.space.sm }}>
          {pending.length && !running ? (
            <Button
              title={pending.length === 1 ? `Connect ${pending[0]!.label}` : `Connect all ${pending.length}`}
              icon={Wifi}
              onPress={() => void setup.connectAll()}
              fullWidth
              testID="setup-connect-all"
            />
          ) : null}
          {s.phase === 'done' && done.length ? (
            <Button title="Go to my garden" onPress={close} fullWidth testID="setup-finish" />
          ) : null}
          {!running ? (
            <Button
              title="Set up manually instead"
              variant="ghost"
              onPress={() => router.push('/onboarding')}
              testID="setup-manual"
            />
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

function Hero({
  state,
  allDone,
  doneCount,
  showHint,
}: {
  state: AutoSetupState;
  allDone: boolean;
  doneCount: number;
  showHint: boolean;
}) {
  const t = useTheme();
  if (allDone) {
    return (
      <Animated.View entering={ZoomIn.springify().damping(14)} style={{ alignItems: 'center', gap: t.space.md, paddingVertical: t.space.lg }}>
        <View
          style={{
            width: 96,
            height: 96,
            borderRadius: 48,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: t.colors.accentSoft,
          }}
        >
          <PartyPopper size={44} color={t.colors.accent} />
        </View>
        <Text variant="title" align="center" accessibilityRole="header">
          {doneCount === 1 ? 'Your device is ready' : `${doneCount} devices are ready`}
        </Text>
        <Text variant="body" tone="textSecondary" align="center">
          Watering is automatic. You can check on your plants from any internet, anywhere.
        </Text>
      </Animated.View>
    );
  }
  if (state.phase === 'running') {
    const total = state.items.filter((i) => i.status !== 'skipped').length;
    const at = state.items.filter((i) => isFinished(i) || i.status === 'failed').length + 1;
    return (
      <View style={{ gap: t.space.xs }} accessibilityLiveRegion="polite">
        <Text variant="title" accessibilityRole="header">
          Connecting{total > 1 ? ` ${Math.min(at, total)} of ${total}` : ''}…
        </Text>
        <Text variant="body" tone="textSecondary">
          Keep your phone close to the devices. This takes about 30 seconds each.
        </Text>
      </View>
    );
  }
  if (state.items.length) {
    const n = state.items.filter((i) => i.status === 'found').length;
    return (
      <View style={{ gap: t.space.xs }}>
        <Text variant="title" accessibilityRole="header">
          {n === 0 ? 'Nearby devices' : n === 1 ? '1 device found' : `${n} devices found`}
        </Text>
        <Text variant="body" tone="textSecondary">
          {state.phase === 'scanning' ? 'Still looking for more…' : 'Tap connect and the app does the rest.'}
        </Text>
      </View>
    );
  }
  return (
    <Animated.View entering={FadeIn} style={{ alignItems: 'center', gap: t.space.lg, paddingTop: t.space.lg }}>
      <Radar size={180} />
      <View style={{ gap: t.space.xs }}>
        <Text variant="heading" align="center" accessibilityRole="header">
          Looking for Xeno devices…
        </Text>
        <Text variant="body" tone="textSecondary" align="center">
          Make sure they’re powered on and close to your phone.
        </Text>
      </View>
      {showHint ? (
        <Animated.View entering={FadeInDown}>
          <Card variant="glass">
            <Text variant="label">Can’t find it?</Text>
            <Text variant="caption" tone="textSecondary" style={{ marginTop: 4 }}>
              A device that was set up before only shows up in setup mode: hold its button for 5 seconds until the
              light starts blinking.
            </Text>
          </Card>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

function DeviceRow({ item, onRetry, disabled }: { item: SetupItem; onRetry: () => void; disabled: boolean }) {
  const t = useTheme();
  const failed = item.status === 'failed';
  const ok = item.status === 'online' || item.status === 'waiting';
  const skipped = item.status === 'skipped';
  const tint = failed ? t.colors.danger : ok ? t.colors.accent : skipped ? t.colors.textTertiary : t.colors.accent;
  const bg = failed ? t.colors.dangerSoft : skipped ? t.colors.surfaceAlt : t.colors.accentSoft;
  return (
    <Card padding={t.space.lg} testID={`setup-item-${item.id}`} accessibilityLabel={`${item.label}: ${item.detail ?? ''}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: bg }}>
          {ok ? (
            <Animated.View entering={ZoomIn}>
              <Check size={22} color={tint} strokeWidth={2.6} />
            </Animated.View>
          ) : failed ? (
            <AlertTriangle size={20} color={tint} />
          ) : (
            <Sprout size={20} color={tint} />
          )}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="subheading" numberOfLines={1}>
            {item.label}
          </Text>
          <Text variant="caption" tone={failed ? 'danger' : 'textSecondary'} testID={`setup-detail-${item.id}`}>
            {item.detail}
          </Text>
        </View>
        {isBusy(item) ? (
          <ActivityIndicator color={t.colors.accent} />
        ) : failed ? (
          <Button title="Retry" size="md" variant="secondary" onPress={onRetry} disabled={disabled} testID={`setup-retry-${item.id}`} />
        ) : item.status === 'found' ? (
          <SignalIcon rssi={item.rssi} color={t.colors.textTertiary} />
        ) : null}
      </View>
    </Card>
  );
}

function WifiPrompt({
  request,
  onSubmit,
  onCancel,
}: {
  request: WifiRequest;
  onSubmit: (ssid: string, password: string) => void;
  onCancel: () => void;
}) {
  const t = useTheme();
  const [ssid, setSsid] = useState(request.suggested ?? request.networks[0]?.ssid ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const network: WifiNetwork | undefined = request.networks.find((n) => n.ssid === ssid);
  const open = network ? !network.secure : false;

  const title =
    request.reason === 'wrong_password'
      ? 'That password didn’t work'
      : request.reason === 'phone_network_not_visible'
        ? 'Choose a WiFi it can reach'
        : `WiFi for ${request.label}`;
  const message =
    request.reason === 'wrong_password'
      ? 'Check the password — it’s case-sensitive — and try again.'
      : request.reason === 'phone_network_not_visible'
        ? `Your phone is on “${request.phoneSsid}”, but ${request.label} can’t see it (it may be a 5 GHz network). Pick a network below.`
        : 'Type the password once. Every other Xeno device will use it automatically.';

  const submit = () => {
    if (!ssid) return setError('Choose a network');
    if (!open && password.length < 8) return setError('WiFi passwords are at least 8 characters');
    setError(null);
    onSubmit(ssid, open ? '' : password);
  };

  return (
    <Animated.View entering={FadeInDown.springify().damping(18)}>
      <Card variant="tinted" tint={t.colors.accentSoft} padding={t.space.xl} testID="wifi-prompt">
        <View style={{ gap: t.space.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
            <View
              style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.surface }}
            >
              <Wifi size={20} color={t.colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="heading">{title}</Text>
            </View>
          </View>
          <Text variant="body" tone="textSecondary">
            {message}
          </Text>

          {request.networks.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space.sm }}>
              {request.networks.slice(0, 8).map((n) => (
                <Chip
                  key={n.ssid}
                  label={n.ssid}
                  icon={n.secure ? Lock : undefined}
                  selected={n.ssid === ssid}
                  onPress={() => {
                    setSsid(n.ssid);
                    setError(null);
                  }}
                  testID={`wifi-choice-${n.ssid}`}
                />
              ))}
            </ScrollView>
          ) : null}

          {open ? (
            <Text variant="caption" tone="textSecondary">
              “{ssid}” is an open network — no password needed.
            </Text>
          ) : (
            <TextField
              label={ssid ? `Password for “${ssid}”` : 'WiFi password'}
              icon={Lock}
              secure
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                setError(null);
              }}
              error={error}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={submit}
              testID="wifi-prompt-password"
            />
          )}
          {open && error ? (
            <Text variant="caption" tone="danger">
              {error}
            </Text>
          ) : null}

          <View style={{ gap: t.space.sm }}>
            <Button title="Connect" icon={Wifi} onPress={submit} fullWidth testID="wifi-prompt-connect" />
            <Button title="Not now" variant="ghost" onPress={onCancel} testID="wifi-prompt-cancel" />
          </View>
        </View>
      </Card>
    </Animated.View>
  );
}
