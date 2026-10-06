import { router } from 'expo-router';
import { ChevronRight, ScanLine } from 'lucide-react-native';
import { View } from 'react-native';
import { useTheme } from '@/design';
import { relativeTime } from '@/lib/format';
import { Badge, Card, PressableScale, Text } from '@/ui';
import { Image } from 'expo-image';
import { useScans } from './hooks';
import { scanSubtitle, statusVisual } from './visuals';

/** Garden dashboard: the latest plant scan, or an invitation to do the first one. */
export function LatestScanCard({ now }: { now: number }) {
  const t = useTheme();
  const scans = useScans();
  // Never get in the way of the irrigation dashboard: no skeletons, no errors here.
  if (!scans.isSuccess) return null;
  const latest = scans.data.items[0];

  if (!latest) {
    return (
      <PressableScale onPress={() => router.navigate('/scan')} accessibilityLabel="Scan a leaf for disease" testID="latest-scan-cta">
        <Card variant="tinted" padding={t.space.lg}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.accentSoft }}>
              <ScanLine size={22} color={t.colors.accent} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">Check your plants for disease</Text>
              <Text variant="caption" tone="textSecondary">
                Snap a leaf, get the diagnosis and what to do
              </Text>
            </View>
            <ChevronRight size={18} color={t.colors.textTertiary} />
          </View>
        </Card>
      </PressableScale>
    );
  }

  const v = statusVisual(latest, t);
  const sub = scanSubtitle(latest);
  return (
    <PressableScale
      onPress={() => router.push({ pathname: '/scans/[id]', params: { id: latest.id } })}
      accessibilityLabel={`Last plant scan: ${latest.title}, ${v.label}`}
      testID="latest-scan"
    >
      <Card padding={t.space.md}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
          <Image
            source={latest.imageUrl ? { uri: latest.imageUrl } : undefined}
            style={{ width: 64, height: 64, borderRadius: t.radius.sm, backgroundColor: t.colors.surfaceAlt }}
            contentFit="cover"
          />
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="overline" tone="textSecondary">
              Last plant scan
            </Text>
            <Text variant="bodyStrong" numberOfLines={1}>
              {latest.title}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
              <Badge label={v.label} color={v.color} background={v.soft} dot />
              <Text variant="caption" tone="textTertiary" numberOfLines={1} style={{ flex: 1 }}>
                {[sub, relativeTime(latest.createdAt, now)].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </View>
          <ChevronRight size={18} color={t.colors.textTertiary} />
        </View>
      </Card>
    </PressableScale>
  );
}
