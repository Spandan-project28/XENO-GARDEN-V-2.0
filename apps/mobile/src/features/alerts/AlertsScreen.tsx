import type { AlertPublic } from '@xeno/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { BellRing, Check, CheckCheck, Leaf, Sprout } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { ConnectionBanner } from '@/components/ConnectionBanner';
import { useTheme } from '@/design';
import { errorMessage } from '@/lib/api';
import { useNow } from '@/lib/useNow';
import { Banner, Button, EmptyState, Screen, SegmentedControl, Sheet, SkeletonCard, Text } from '@/ui';
import { AlertRow } from './AlertRow';
import { useAlertActions, useAlerts, type AlertFilter } from './hooks';
import { ALERT_META, dayLabel } from './meta';

export function AlertsScreen() {
  const t = useTheme();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const [filter, setFilter] = useState<AlertFilter>('active');
  const alerts = useAlerts(filter);
  const { ack, resolve } = useAlertActions();
  const now = useNow(60_000);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const items = useMemo(() => alerts.data?.pages.flatMap((p) => p.items) ?? [], [alerts.data]);
  const sections = useMemo(() => {
    const out: { day: string; items: AlertPublic[] }[] = [];
    for (const a of items) {
      const day = dayLabel(a.lastSeenAt, now);
      const last = out[out.length - 1];
      if (last?.day === day) last.items.push(a);
      else out.push({ day, items: [a] });
    }
    return out;
  }, [items, now]);
  // An alert opened from a push notification (?focus=id) opens its sheet once.
  const [focusHandled, setFocusHandled] = useState(false);
  const activeId = selectedId ?? (focusHandled ? null : (focus ?? null));
  const selected = items.find((a) => a.id === activeId) ?? null;

  const close = () => {
    setSelectedId(null);
    setFocusHandled(true);
  };

  return (
    <Screen
      withTabBar
      title="Alerts"
      subtitle="Only what needs your attention"
      refreshing={alerts.isRefetching && !alerts.isFetchingNextPage}
      onRefresh={() => void alerts.refetch()}
      testID="alerts-screen"
    >
      <View style={{ gap: t.space.lg }}>
        <ConnectionBanner />
        <SegmentedControl
          options={[
            { value: 'active', label: 'Active', icon: BellRing },
            { value: 'all', label: 'All', icon: Leaf },
          ]}
          value={filter}
          onChange={setFilter}
        />

        {alerts.isPending ? (
          <>
            <SkeletonCard height={110} />
            <SkeletonCard height={110} />
          </>
        ) : alerts.isError && !items.length ? (
          <Banner tone="danger" title="Couldn't load alerts" message={errorMessage(alerts.error)} />
        ) : !items.length ? (
          <EmptyState
            icon={Sprout}
            title={filter === 'active' ? 'All clear' : 'No alerts yet'}
            message={
              filter === 'active'
                ? 'Nothing needs your attention. Your garden is taking care of itself.'
                : 'When something needs attention, it shows up here and on your phone.'
            }
          />
        ) : (
          <>
            {filter === 'active' ? (
              <Text variant="caption" tone="textTertiary">
                Swipe left on an alert to mark it seen or resolved.
              </Text>
            ) : null}
            {sections.map((s) => (
              <View key={s.day} style={{ gap: t.space.sm }}>
                <Text variant="overline" tone="textSecondary" accessibilityRole="header">
                  {s.day}
                </Text>
                {s.items.map((a) => (
                  <Animated.View key={a.id} entering={FadeIn} layout={LinearTransition}>
                    <AlertRow
                      alert={a}
                      now={now}
                      highlighted={a.id === focus}
                      onPress={() => setSelectedId(a.id)}
                      onAck={() => ack.mutate(a)}
                      onResolve={() => resolve.mutate(a)}
                    />
                  </Animated.View>
                ))}
              </View>
            ))}
            {alerts.hasNextPage ? (
              <Button
                title="Load older alerts"
                variant="secondary"
                size="md"
                loading={alerts.isFetchingNextPage}
                onPress={() => void alerts.fetchNextPage()}
              />
            ) : null}
          </>
        )}
      </View>

      <Sheet
        visible={!!selected}
        onClose={close}
        title={selected ? ALERT_META[selected.type].title : undefined}
        subtitle={selected?.message}
      >
        {selected ? (
          <View style={{ gap: t.space.md }}>
            <Banner tone="info" title="What to do" message={ALERT_META[selected.type].tip} />
            {selected.status === 'open' ? (
              <Button
                title="Mark as seen"
                icon={Check}
                variant="secondary"
                onPress={() => {
                  ack.mutate(selected);
                  close();
                }}
              />
            ) : null}
            {selected.status !== 'resolved' ? (
              <Button
                title="Resolve"
                icon={CheckCheck}
                onPress={() => {
                  resolve.mutate(selected);
                  close();
                }}
                testID="sheet-resolve"
              />
            ) : null}
            <Button
              title={`Open ${selected.deviceName ?? 'device'}`}
              variant="ghost"
              onPress={() => {
                close();
                router.push(`/device/${selected.deviceId}`);
              }}
            />
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
