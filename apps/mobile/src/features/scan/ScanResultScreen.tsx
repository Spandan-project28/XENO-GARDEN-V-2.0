import type { ScanPublic, ScanSensorTip } from '@xeno/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CloudRain,
  Droplets,
  Info,
  Lightbulb,
  ScanLine,
  ShieldCheck,
  Thermometer,
  Trash,
  Wind,
} from 'lucide-react-native';
import { Alert, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/design';
import { errorMessage } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { Badge, Banner, Button, Card, IconButton, Screen, SkeletonCard, Text, toast } from '@/ui';
import { useDeleteScan, useScan } from './hooks';
import { confidenceText, scanSubtitle, severityLabel, statusVisual } from './visuals';

export function ScanResultScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scan = useScan(id);
  const back = <IconButton icon={ArrowLeft} accessibilityLabel="Back" onPress={() => router.back()} />;
  return (
    <Screen headerLeft={back} title="Scan result" testID="scan-result">
      {scan.data ? (
        <Result scan={scan.data} />
      ) : scan.isError ? (
        <Banner tone="danger" title="Couldn’t load this scan" message={errorMessage(scan.error)} />
      ) : (
        <SkeletonCard height={420} />
      )}
    </Screen>
  );
}

function Result({ scan }: { scan: ScanPublic }) {
  const t = useTheme();
  const now = useNow(60_000);
  const remove = useDeleteScan();
  const v = statusVisual(scan, t);
  const sub = scanSubtitle(scan);

  const confirmDelete = () =>
    Alert.alert('Delete this scan?', 'The photo and result will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          remove.mutate(scan.id, {
            onSuccess: () => router.back(),
            onError: (err) => toast.error('Couldn’t delete', errorMessage(err)),
          }),
      },
    ]);

  const sections: { title: string; icon: typeof Info; items: string[]; numbered?: boolean }[] = [
    { title: 'What to do now', icon: Lightbulb, items: scan.treatment, numbered: true },
    { title: scan.status === 'healthy' ? 'Keep it healthy' : 'Prevent it next time', icon: ShieldCheck, items: scan.prevention },
  ];

  return (
    <View style={{ gap: t.space.lg }}>
      <Card variant="glass" padding={0}>
        <View style={{ borderRadius: t.radius.lg, overflow: 'hidden' }}>
          <Image
            source={scan.imageUrl ? { uri: scan.imageUrl } : undefined}
            style={{ width: '100%', aspectRatio: 1, backgroundColor: t.colors.surfaceAlt }}
            contentFit="cover"
            transition={200}
            accessibilityLabel="Scanned leaf"
          />
          <View style={{ padding: t.space.xl, gap: t.space.sm }}>
            <View style={{ flexDirection: 'row', gap: t.space.sm, flexWrap: 'wrap' }}>
              <Badge label={v.label} color={v.color} background={v.soft} dot />
              {scan.status === 'disease' && severityLabel[scan.severity] ? (
                <Badge label={`${severityLabel[scan.severity]} · ${scan.category}`} color={t.colors.textSecondary} />
              ) : null}
            </View>
            <Text variant="title" testID="scan-title">
              {scan.title}
            </Text>
            {sub ? (
              <Text variant="label" tone="textSecondary">
                {sub}
              </Text>
            ) : null}
            <Confidence value={scan.confidence} color={v.color} />
            <Text variant="body" tone="textSecondary">
              {scan.summary}
            </Text>
          </View>
        </View>
      </Card>

      {sections.map((s, i) =>
        s.items.length ? (
          <Animated.View key={s.title} entering={FadeInDown.delay(80 + i * 60)}>
            <Card>
              <View style={{ gap: t.space.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
                  <s.icon size={18} color={t.colors.accent} />
                  <Text variant="subheading">{s.title}</Text>
                </View>
                {s.items.map((item, n) => (
                  <View key={n} style={{ flexDirection: 'row', gap: t.space.md }}>
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        marginTop: 1,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: t.colors.accentSoft,
                      }}
                    >
                      {s.numbered ? (
                        <Text variant="caption" color={t.colors.accent}>
                          {String(n + 1)}
                        </Text>
                      ) : (
                        <CheckCircle2 size={13} color={t.colors.accent} />
                      )}
                    </View>
                    <Text variant="body" style={{ flex: 1 }}>
                      {item}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          </Animated.View>
        ) : null,
      )}

      {scan.sensorTips.length ? (
        <Animated.View entering={FadeInDown.delay(200)}>
          <Card>
            <View style={{ gap: t.space.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
                <Wind size={18} color={t.colors.water} />
                <Text variant="subheading">{scan.deviceName ? `From ${scan.deviceName}’s sensors` : 'From your garden sensors'}</Text>
              </View>
              {scan.conditions ? <Conditions scan={scan} /> : null}
              {scan.sensorTips.map((tip) => (
                <Tip key={tip.code} tip={tip} />
              ))}
            </View>
          </Card>
        </Animated.View>
      ) : null}

      {scan.alternatives.length ? (
        <Card variant="outline">
          <View style={{ gap: t.space.sm }}>
            <Text variant="overline" tone="textSecondary">
              Other possibilities
            </Text>
            {scan.alternatives.map((a) => (
              <View key={a.label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.md }}>
                <Text variant="body" tone="textSecondary" style={{ flex: 1 }}>
                  {a.label}
                </Text>
                <Text variant="label" tone="textSecondary" tabular>
                  {`${Math.round(a.confidence * 100)} %`}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      <Text variant="caption" tone="textTertiary" align="center">
        {`Analyzed by ${scan.model.name} · ${relativeTime(scan.createdAt, now)}`}
        {'\n'}AI can be wrong. For valuable crops, confirm with a local agriculture expert.
      </Text>

      <View style={{ gap: t.space.sm }}>
        <Button title="Scan another leaf" icon={ScanLine} onPress={() => router.navigate('/scan')} fullWidth testID="scan-again" />
        <Button title="Delete scan" icon={Trash} variant="ghost" onPress={confirmDelete} loading={remove.isPending} fullWidth testID="scan-delete" />
      </View>
    </View>
  );
}

function Confidence({ value, color }: { value: number | null; color: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }} accessible accessibilityLabel={`Confidence: ${confidenceText(value)}`} testID="scan-confidence">
      {value !== null ? (
        <View style={{ height: 8, borderRadius: 4, backgroundColor: t.colors.surfaceAlt, overflow: 'hidden' }}>
          <View style={{ width: `${Math.max(3, Math.round(value * 100))}%`, height: '100%', borderRadius: 4, backgroundColor: color }} />
        </View>
      ) : null}
      <Text variant="caption" tone="textSecondary">
        {confidenceText(value)}
      </Text>
    </View>
  );
}

function Conditions({ scan }: { scan: ScanPublic }) {
  const t = useTheme();
  const c = scan.conditions!;
  const cells = [
    { icon: Droplets, label: 'Soil', value: c.soilMoisture === null ? '—' : `${Math.round(c.soilMoisture)} %`, color: t.colors.water },
    { icon: Thermometer, label: 'Temp', value: c.temperature === null ? '—' : `${Math.round(c.temperature)} °C`, color: t.colors.sun },
    { icon: Wind, label: 'Humidity', value: c.humidity === null ? '—' : `${Math.round(c.humidity)} %`, color: t.colors.humidity },
    { icon: CloudRain, label: 'Rain', value: c.rain === null ? '—' : c.rain ? 'Yes' : 'No', color: t.colors.rain },
  ];
  return (
    <View style={{ flexDirection: 'row', gap: t.space.sm }}>
      {cells.map(({ icon: Icon, label, value, color }) => (
        <View key={label} style={{ flex: 1, alignItems: 'center', gap: 2, paddingVertical: t.space.sm, borderRadius: t.radius.sm, backgroundColor: t.colors.surfaceAlt }}>
          <Icon size={15} color={color} />
          <Text variant="label" tabular>
            {value}
          </Text>
          <Text variant="caption" tone="textTertiary">
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Tip({ tip }: { tip: ScanSensorTip }) {
  const t = useTheme();
  const m = {
    warning: { icon: AlertTriangle, color: t.colors.warning, bg: t.colors.warningSoft },
    good: { icon: CheckCircle2, color: t.colors.accent, bg: t.colors.accentSoft },
    info: { icon: Info, color: t.colors.info, bg: t.colors.waterSoft },
  }[tip.tone];
  return (
    <View style={{ flexDirection: 'row', gap: t.space.md, padding: t.space.md, borderRadius: t.radius.sm, backgroundColor: m.bg }} testID={`scan-tip-${tip.code}`}>
      <m.icon size={18} color={m.color} />
      <Text variant="body" style={{ flex: 1 }}>
        {tip.message}
      </Text>
    </View>
  );
}
