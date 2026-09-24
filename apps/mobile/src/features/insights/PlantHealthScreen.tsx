import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HealthFinding, HealthReport, HealthStatus } from '@xeno/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, Info, Leaf, Sparkles, Sprout, XCircle } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { flags } from '@/config/flags';
import { useTheme, type Theme } from '@/design';
import { useDevice } from '@/features/devices';
import { api, errorMessage } from '@/lib/api';
import { upsertDevice } from '@/lib/deviceCache';
import { relativeTime } from '@/lib/format';
import { qk } from '@/lib/queryKeys';
import { useNow } from '@/lib/useNow';
import { Banner, Button, Card, EmptyState, Gauge, IconButton, Screen, SkeletonCard, Text, TextField, toast } from '@/ui';

export function PlantHealthScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const device = useDevice(id);
  const back = <IconButton icon={ArrowLeft} accessibilityLabel="Back" onPress={() => router.back()} />;
  if (!device.data) {
    return (
      <Screen headerLeft={back} title="Plant health">
        <SkeletonCard height={300} />
      </Screen>
    );
  }
  return (
    <Screen headerLeft={back} title="Plant health" subtitle={device.data.name} keyboard testID="plant-health">
      {device.data.plantId ? (
        <Health plantId={device.data.plantId} />
      ) : (
        <CreatePlant deviceId={device.data.id} deviceName={device.data.name} />
      )}
    </Screen>
  );
}

const statusTone = (s: HealthStatus, t: Theme) =>
  s === 'healthy'
    ? { color: t.colors.accent, label: 'Healthy' }
    : s === 'attention'
      ? { color: t.colors.warning, label: 'Needs attention' }
      : s === 'critical'
        ? { color: t.colors.danger, label: 'Critical' }
        : { color: t.colors.textSecondary, label: 'Not enough data' };

function Health({ plantId }: { plantId: string }) {
  const t = useTheme();
  const qc = useQueryClient();
  const now = useNow(60_000);
  const health = useQuery({ queryKey: qk.plantHealth(plantId), queryFn: () => api.plants.health(plantId) });
  const run = useMutation({
    mutationFn: () => api.plants.runHealth(plantId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.plantHealth(plantId) }),
    onError: (err) => toast.error('Check failed', errorMessage(err)),
  });

  if (health.isPending) return <SkeletonCard height={320} />;
  if (health.isError) return <Banner tone="danger" title="Couldn't load plant health" message={errorMessage(health.error)} />;

  const latest = health.data.latest;
  const runButton = (
    <Button title={latest ? 'Run a new check' : 'Run first check'} icon={Sparkles} onPress={() => run.mutate()} loading={run.isPending} fullWidth testID="run-health" />
  );

  if (!latest) {
    return (
      <View style={{ gap: t.space.lg }}>
        <EmptyState
          icon={Leaf}
          title="No health check yet"
          message="We look at how moisture, watering and temperature behaved over the last days to spot problems early."
        />
        {runButton}
      </View>
    );
  }

  const tone = statusTone(latest.status, t);
  return (
    <View style={{ gap: t.space.lg }}>
      <Card variant="glass" padding={t.space.xl}>
        <View style={{ alignItems: 'center', gap: t.space.md }}>
          <Gauge value={latest.score} size={200} color={tone.color} label="Health score" unit="" testID="health-score" />
          <Text variant="heading" color={tone.color}>
            {tone.label}
          </Text>
          <Text variant="body" tone="textSecondary" align="center">
            {latest.summary}
          </Text>
          <Text variant="caption" tone="textTertiary">
            {`Checked ${relativeTime(latest.createdAt, now)} · ${providerLabel(latest)}`}
          </Text>
        </View>
      </Card>

      {latest.findings.length ? (
        <View style={{ gap: t.space.sm }}>
          <Text variant="overline" tone="textSecondary">
            What we noticed
          </Text>
          {latest.findings.map((f, i) => (
            <Animated.View key={`${f.code}-${i}`} entering={FadeInDown.delay(i * 60)}>
              <Finding finding={f} />
            </Animated.View>
          ))}
        </View>
      ) : null}

      {flags.photoUpload ? (
        <Card variant="tinted" tint={t.colors.waterSoft}>
          <View style={{ flexDirection: 'row', gap: t.space.md, alignItems: 'center' }}>
            <Camera size={24} color={t.colors.water} />
            <View style={{ flex: 1 }}>
              <Text variant="subheading">Photo check</Text>
              <Text variant="caption" tone="textSecondary">
                Snap a leaf to detect disease and pests with our plant model.
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      {runButton}

      {health.data.history.length > 1 ? (
        <Card>
          <View style={{ gap: t.space.sm }}>
            <Text variant="overline" tone="textSecondary">
              Previous checks
            </Text>
            {health.data.history.slice(1, 6).map((h) => (
              <View key={h.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="body" tone="textSecondary">
                  {relativeTime(h.createdAt, now)}
                </Text>
                <Text variant="bodyStrong" color={statusTone(h.status, t).color} tabular>
                  {h.score === null ? '—' : Math.round(h.score)}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
    </View>
  );
}

const providerLabel = (r: HealthReport) => (r.provider.startsWith('ml:') ? 'AI model' : 'Smart rules');

function Finding({ finding }: { finding: HealthFinding }) {
  const t = useTheme();
  const map = {
    info: { icon: Info, color: t.colors.info, bg: t.colors.waterSoft },
    warning: { icon: AlertTriangle, color: t.colors.warning, bg: t.colors.warningSoft },
    critical: { icon: XCircle, color: t.colors.danger, bg: t.colors.dangerSoft },
  }[finding.severity];
  const Icon = finding.severity === 'info' && finding.confidence >= 0.8 ? CheckCircle2 : map.icon;
  return (
    <Card padding={t.space.md}>
      <View style={{ flexDirection: 'row', gap: t.space.md }}>
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: map.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={18} color={map.color} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="body">{finding.message}</Text>
          <Text variant="caption" tone="textTertiary">
            {`Confidence ${Math.round(finding.confidence * 100)}%`}
          </Text>
        </View>
      </View>
    </Card>
  );
}

function CreatePlant({ deviceId, deviceName }: { deviceId: string; deviceName: string }) {
  const t = useTheme();
  const qc = useQueryClient();
  const [name, setName] = useState(deviceName);
  const [species, setSpecies] = useState('');
  const create = useMutation({
    mutationFn: async () => {
      const plant = await api.plants.create({ name: name.trim(), species: species.trim() || null });
      return api.devices.update(deviceId, { plantId: plant.id });
    },
    onSuccess: (d) => upsertDevice(qc, d),
    onError: (err) => toast.error("Couldn't save the plant", errorMessage(err)),
  });
  return (
    <View style={{ gap: t.space.lg }}>
      <EmptyState compact icon={Sprout} title="What are you growing?" message="Tell us about the plant this device waters. Health checks get smarter with it." />
      <TextField label="Plant name" value={name} onChangeText={setName} maxLength={60} testID="plant-name" />
      <TextField label="Species (optional)" value={species} onChangeText={setSpecies} placeholder="e.g. Tomato, Basil, Monstera" maxLength={80} testID="plant-species" />
      <Button title="Save plant" onPress={() => create.mutate()} loading={create.isPending} disabled={!name.trim()} fullWidth testID="save-plant" />
    </View>
  );
}
