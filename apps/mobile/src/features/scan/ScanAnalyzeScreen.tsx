import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { ArrowLeft, RotateCcw, ScanSearch } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@/design';
import { useDevices } from '@/features/devices';
import { errorMessage } from '@/lib/api';
import { Banner, Button, Chip, IconButton, Screen, Text } from '@/ui';
import { rememberScan, useScanStatus } from './hooks';
import { pickScanPhoto, uploadAndScan, type ScanImageType, type ScanStep } from './scanPhoto';

const NONE = 'none';

export function ScanAnalyzeScreen() {
  const t = useTheme();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ uri?: string; type?: string }>();
  const [photo, setPhoto] = useState(() =>
    params.uri ? { uri: params.uri, type: (params.type as ScanImageType | undefined) ?? 'image/jpeg' } : null,
  );
  const devices = useDevices();
  const status = useScanStatus();
  const list = useMemo(() => devices.data ?? [], [devices.data]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [step, setStep] = useState<ScanStep | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Link to the first device by default: its sensors make the advice better.
  const chosen = deviceId ?? list[0]?.id ?? NONE;
  const notReady = status.data ? !status.data.ready : false;

  const analyze = async () => {
    if (!photo) return;
    setError(null);
    try {
      const scan = await uploadAndScan(photo, chosen === NONE ? null : chosen, setStep);
      rememberScan(qc, scan);
      router.replace({ pathname: '/scans/[id]', params: { id: scan.id } });
    } catch (err) {
      setError(errorMessage(err));
      setStep(null);
    }
  };

  const retake = async () => {
    const r = await pickScanPhoto('camera');
    if (r.kind === 'photo') {
      setPhoto(r.photo);
      setError(null);
    } else if (r.kind === 'denied') {
      router.back();
    }
  };

  const busy = step !== null;
  return (
    <Screen
      headerLeft={<IconButton icon={ArrowLeft} accessibilityLabel="Back" onPress={() => router.back()} disabled={busy} />}
      title="Analyze leaf"
      testID="scan-analyze"
    >
      <View style={{ gap: t.space.lg }}>
        {photo ? <Preview uri={photo.uri} scanning={busy} /> : <Banner tone="danger" title="No photo" message="Go back and take a photo of a leaf." />}

        {notReady ? <Banner tone="warning" title="Disease model not connected" message={status.data?.message} /> : null}

        {list.length ? (
          <View style={{ gap: t.space.sm }}>
            <Text variant="overline" tone="textSecondary">
              Which garden is this plant in?
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
              {list.map((d) => (
                <Chip key={d.id} label={d.name} selected={chosen === d.id} onPress={() => setDeviceId(d.id)} testID={`scan-device-${d.id}`} />
              ))}
              <Chip label="Not linked" selected={chosen === NONE} onPress={() => setDeviceId(NONE)} testID="scan-device-none" />
            </View>
            <Text variant="caption" tone="textTertiary">
              Linking a garden adds advice from its live soil, humidity and rain sensors.
            </Text>
          </View>
        ) : null}

        {error ? <Banner tone="danger" title="Scan failed" message={error} /> : null}

        {busy ? (
          <Animated.View entering={FadeIn} style={{ alignItems: 'center', gap: 4 }} accessibilityLiveRegion="polite">
            <Text variant="bodyStrong">{step === 'uploading' ? 'Uploading photo…' : 'Checking for diseases…'}</Text>
            <Text variant="caption" tone="textTertiary">
              {step === 'uploading' ? 'Sending the leaf to your Xeno server' : 'The AI model is looking at the leaf'}
            </Text>
          </Animated.View>
        ) : (
          <View style={{ gap: t.space.sm }}>
            <Button
              title={error ? 'Try again' : 'Analyze leaf'}
              icon={ScanSearch}
              onPress={() => void analyze()}
              disabled={!photo || notReady}
              fullWidth
              testID="scan-analyze-button"
            />
            <Button title="Retake photo" icon={RotateCcw} variant="ghost" onPress={() => void retake()} fullWidth testID="scan-retake" />
          </View>
        )}
      </View>
    </Screen>
  );
}

/** The photo, with a light sweeping across it while the model works. */
function Preview({ uri, scanning }: { uri: string; scanning: boolean }) {
  const t = useTheme();
  const [size, setSize] = useState(0);
  const y = useSharedValue(0);
  useEffect(() => {
    if (scanning && size) {
      y.value = 0;
      y.value = withRepeat(withTiming(size - 4, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, true);
    } else {
      cancelAnimation(y);
    }
  }, [scanning, size, y]);
  const line = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <View
      onLayout={(e) => setSize(e.nativeEvent.layout.width)}
      style={{
        aspectRatio: 1,
        borderRadius: t.radius.lg,
        overflow: 'hidden',
        backgroundColor: t.colors.surfaceAlt,
        borderWidth: 1,
        borderColor: scanning ? t.colors.accent : t.colors.border,
      }}
    >
      <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" accessibilityLabel="Leaf photo" />
      {scanning ? (
        <>
          <View style={{ position: 'absolute', inset: 0, backgroundColor: t.colors.overlay, opacity: 0.25 }} />
          <Animated.View
            style={[
              {
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                height: 4,
                backgroundColor: t.colors.accent,
                shadowColor: t.colors.accent,
                shadowOpacity: 0.9,
                shadowRadius: 12,
                elevation: 6,
              },
              line,
            ]}
          />
        </>
      ) : null}
    </View>
  );
}
