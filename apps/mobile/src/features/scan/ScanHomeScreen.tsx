import type { ScanPublic } from '@xeno/shared';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { Camera, ChevronRight, Focus, ImagePlus, Leaf, ScanLine, Settings, Sun } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/design';
import { errorMessage } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { Badge, Banner, Button, Card, EmptyState, PressableScale, Screen, SkeletonCard, Text, toast } from '@/ui';
import { useScans, useScanStatus } from './hooks';
import { pickScanPhoto } from './scanPhoto';
import { scanSubtitle, statusVisual } from './visuals';

type Source = 'camera' | 'library';

export function ScanHomeScreen() {
  const t = useTheme();
  const status = useScanStatus();
  const scans = useScans();
  const now = useNow(60_000);
  const [busy, setBusy] = useState<Source | null>(null);
  const [denied, setDenied] = useState<{ source: Source; settings: boolean } | null>(null);

  const start = async (source: Source) => {
    setBusy(source);
    setDenied(null);
    try {
      const r = await pickScanPhoto(source);
      if (r.kind === 'photo') router.push({ pathname: '/scans/analyze', params: { uri: r.photo.uri, type: r.photo.type } });
      else if (r.kind === 'denied') setDenied({ source, settings: r.settings });
      else if (r.kind === 'too_large') toast.error('Photo too large', 'Crop it closer to the leaf and try again.');
    } catch (err) {
      toast.error(source === 'camera' ? 'Couldn’t open the camera' : 'Couldn’t open your photos', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const items = scans.data?.items ?? [];

  return (
    <Screen
      withTabBar
      eyebrow="Leaf disease check"
      title="Plant scan"
      refreshing={scans.isRefetching}
      onRefresh={() => {
        void scans.refetch();
        void status.refetch();
      }}
      testID="scan-home"
    >
      <View style={{ gap: t.space.lg }}>
        {status.data && !status.data.ready ? (
          <Banner tone="warning" title="Disease model not connected" message={status.data.message} />
        ) : null}

        {denied ? (
          <Banner
            tone="warning"
            title={denied.source === 'camera' ? 'Camera access is off' : 'Photo access is off'}
            message={
              denied.settings
                ? `Allow ${denied.source === 'camera' ? 'the camera' : 'photos'} for Xeno Garden in your phone’s settings to scan leaves.`
                : `Xeno Garden needs ${denied.source === 'camera' ? 'the camera' : 'your photos'} to scan a leaf. Tap the button again and choose Allow.`
            }
            action={
              denied.settings ? (
                <Button title="Open settings" icon={Settings} size="md" variant="secondary" onPress={() => void Linking.openSettings()} />
              ) : undefined
            }
          />
        ) : null}

        <Card variant="glass" padding={t.space.xl}>
          <View style={{ alignItems: 'center', gap: t.space.md }}>
            <View
              style={{
                width: 76,
                height: 76,
                borderRadius: 38,
                backgroundColor: t.colors.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ScanLine size={36} color={t.colors.accent} />
            </View>
            <Text variant="heading" align="center">
              Check a leaf for disease
            </Text>
            <Text variant="body" tone="textSecondary" align="center">
              Photograph one leaf. You’ll see the likely problem, how sure the AI is, and exactly what to do, with tips
              from your Xeno sensors.
            </Text>
            <View style={{ alignSelf: 'stretch', gap: t.space.sm, marginTop: t.space.xs }}>
              <Button title="Take photo" icon={Camera} onPress={() => void start('camera')} loading={busy === 'camera'} disabled={!!busy} fullWidth testID="scan-camera" />
              <Button
                title="Choose from gallery"
                icon={ImagePlus}
                variant="secondary"
                onPress={() => void start('library')}
                loading={busy === 'library'}
                disabled={!!busy}
                fullWidth
                testID="scan-gallery"
              />
            </View>
          </View>
        </Card>

        <View style={{ flexDirection: 'row', gap: t.space.sm }}>
          <Tip icon={Leaf} text="One leaf, filling the frame" />
          <Tip icon={Sun} text="Daylight, no flash" />
          <Tip icon={Focus} text="Sharp, sick side up" />
        </View>

        <View style={{ gap: t.space.sm }}>
          <Text variant="overline" tone="textSecondary">
            Recent scans
          </Text>
          {scans.isPending ? (
            <SkeletonCard height={88} />
          ) : scans.isError ? (
            <Banner
              tone="danger"
              title="Couldn’t load your scans"
              message={errorMessage(scans.error)}
              action={<Button title="Retry" size="md" variant="secondary" onPress={() => void scans.refetch()} />}
            />
          ) : items.length === 0 ? (
            <Card>
              <EmptyState compact icon={ScanLine} title="No scans yet" message="Your leaf scans and their results will appear here." />
            </Card>
          ) : (
            items.map((s, i) => (
              <Animated.View key={s.id} entering={FadeInDown.delay(i * 40)}>
                <ScanRow scan={s} now={now} />
              </Animated.View>
            ))
          )}
        </View>
      </View>
    </Screen>
  );
}

function Tip({ icon: Icon, text }: { icon: typeof Leaf; text: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        flex: 1,
        padding: t.space.md,
        gap: 6,
        borderRadius: t.radius.md,
        backgroundColor: t.colors.surfaceGlass,
        borderWidth: 1,
        borderColor: t.colors.border,
      }}
    >
      <Icon size={16} color={t.colors.accent} />
      <Text variant="caption" tone="textSecondary">
        {text}
      </Text>
    </View>
  );
}

export function ScanRow({ scan, now }: { scan: ScanPublic; now: number }) {
  const t = useTheme();
  const v = statusVisual(scan, t);
  const sub = scanSubtitle(scan);
  return (
    <PressableScale
      onPress={() => router.push({ pathname: '/scans/[id]', params: { id: scan.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${scan.title}, ${v.label}, ${relativeTime(scan.createdAt, now)}`}
      testID={`scan-row-${scan.id}`}
    >
      <Card padding={t.space.md}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
          <Image
            source={scan.imageUrl ? { uri: scan.imageUrl } : undefined}
            style={{ width: 56, height: 56, borderRadius: t.radius.sm, backgroundColor: t.colors.surfaceAlt }}
            contentFit="cover"
            transition={150}
          />
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {scan.title}
            </Text>
            <Text variant="caption" tone="textTertiary" numberOfLines={1}>
              {[sub, relativeTime(scan.createdAt, now)].filter(Boolean).join(' · ')}
            </Text>
            <Badge label={v.label} color={v.color} background={v.soft} dot />
          </View>
          <ChevronRight size={18} color={t.colors.textTertiary} />
        </View>
      </Card>
    </PressableScale>
  );
}
