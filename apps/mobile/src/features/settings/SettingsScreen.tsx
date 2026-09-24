import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ALERT_TYPES, type AlertType, type NotificationPrefs } from '@xeno/shared';
import { Bell, Info, LogOut, Moon, Pencil, Server, Smartphone, Sun, SunMoon, Thermometer } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { env } from '@/config/env';
import { useTheme, type ThemePreference } from '@/design';
import { signOut } from '@/features/auth';
import { api, errorMessage } from '@/lib/api';
import { usePrefs, type TemperatureUnit } from '@/lib/prefs';
import { qk } from '@/lib/queryKeys';
import { sessionStore, useSession } from '@/lib/session';
import { Button, Card, ListGroup, ListRow, Screen, SegmentedControl, Sheet, Text, TextField, Toggle, toast } from '@/ui';

const ALERT_LABELS: Record<AlertType, string> = {
  LOW_MOISTURE: 'Dry soil',
  SENSOR_FAULT: 'Sensor problems',
  DEVICE_OFFLINE: 'Device offline',
  PUMP_MAX_RUNTIME: 'Pump safety stops',
  HIGH_TEMP: 'Heat warnings',
  PLANT_HEALTH: 'Plant health',
};

export function SettingsScreen() {
  const t = useTheme();
  const user = useSession((s) => s.user);
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  const units = usePrefs((s) => s.units);
  const setUnits = usePrefs((s) => s.setUnits);
  const [editName, setEditName] = useState(false);

  const confirmSignOut = () =>
    Alert.alert('Sign out?', 'Your gardens keep running. Sign in again at any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);

  const initials = (user?.name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <Screen withTabBar title="Settings" testID="settings-screen">
      <View style={{ gap: t.space.xl }}>
        <Card onPress={() => setEditName(true)} accessibilityLabel={`Profile, ${user?.name ?? ''}. Edit name`}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.lg }}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: t.colors.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text variant="heading" tone="accent">
                {initials}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="heading">{user?.name ?? 'You'}</Text>
              <Text variant="caption" tone="textSecondary">
                {user?.email}
              </Text>
            </View>
            <Pencil size={18} color={t.colors.textTertiary} />
          </View>
        </Card>

        <View style={{ gap: t.space.sm }}>
          <Text variant="overline" tone="textSecondary" style={{ marginLeft: t.space.xs }}>
            Appearance
          </Text>
          <SegmentedControl<ThemePreference>
            testID="theme-control"
            options={[
              { value: 'system', label: 'Auto', icon: SunMoon },
              { value: 'light', label: 'Light', icon: Sun },
              { value: 'dark', label: 'Dark', icon: Moon },
            ]}
            value={theme}
            onChange={setTheme}
          />
          <SegmentedControl<TemperatureUnit>
            testID="units-control"
            options={[
              { value: 'c', label: '°C', icon: Thermometer },
              { value: 'f', label: '°F', icon: Thermometer },
            ]}
            value={units}
            onChange={setUnits}
          />
        </View>

        <NotificationSettings />

        <ListGroup title="About">
          <ListRow icon={Smartphone} title="App version" value={env.appVersion} />
          <ListRow icon={Server} title="Server" subtitle={env.apiUrl ?? 'Not configured'} />
          <ListRow icon={Info} title="Your data" subtitle="Readings are kept 30 days in detail and hourly summaries after that." />
        </ListGroup>

        <Button title="Sign out" variant="danger" icon={LogOut} onPress={confirmSignOut} testID="sign-out" />
      </View>

      <EditNameSheet visible={editName} onClose={() => setEditName(false)} initial={user?.name ?? ''} />
    </Screen>
  );
}

function NotificationSettings() {
  const t = useTheme();
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: qk.notificationPrefs, queryFn: api.notifications.getPrefs });
  const save = useMutation({
    mutationFn: (p: NotificationPrefs) => api.notifications.setPrefs(p),
    onMutate: (p) => {
      const prev = qc.getQueryData<NotificationPrefs>(qk.notificationPrefs);
      qc.setQueryData(qk.notificationPrefs, p);
      return prev;
    },
    onError: (err, _p, prev) => {
      qc.setQueryData(qk.notificationPrefs, prev);
      toast.error("Couldn't save notification settings", errorMessage(err));
    },
  });
  const p = prefs.data ?? { enabled: true, types: {} };
  const typeOn = (type: AlertType) => p.types[type] !== false;

  return (
    <ListGroup title="Notifications">
      <ListRow
        icon={Bell}
        title="Push notifications"
        subtitle="Alerts on this phone, even when the app is closed"
        right={
          <Toggle
            value={p.enabled}
            onChange={(enabled) => save.mutate({ ...p, enabled })}
            accessibilityLabel="Push notifications"
            testID="notif-master"
          />
        }
      />
      {p.enabled
        ? ALERT_TYPES.map((type) => (
            <ListRow
              key={type}
              title={ALERT_LABELS[type]}
              right={
                <Toggle
                  value={typeOn(type)}
                  onChange={(on) => save.mutate({ ...p, types: { ...p.types, [type]: on } })}
                  accessibilityLabel={`${ALERT_LABELS[type]} notifications`}
                  testID={`notif-${type}`}
                />
              }
            />
          ))
        : null}
      {prefs.isError ? (
        <Text variant="caption" tone="danger" style={{ paddingVertical: t.space.sm }}>
          {errorMessage(prefs.error)}
        </Text>
      ) : null}
    </ListGroup>
  );
}

function EditNameSheet({ visible, onClose, initial }: { visible: boolean; onClose: () => void; initial: string }) {
  const t = useTheme();
  const [name, setName] = useState(initial);
  const save = useMutation({
    mutationFn: (n: string) => api.auth.updateMe({ name: n }),
    onSuccess: (u) => {
      sessionStore.setUser(u);
      onClose();
    },
    onError: (err) => toast.error("Couldn't update your name", errorMessage(err)),
  });
  const trimmed = name.trim();
  return (
    <Sheet visible={visible} onClose={onClose} title="Your name">
      <View style={{ gap: t.space.lg }}>
        <TextField label="Name" value={name} onChangeText={setName} maxLength={60} autoFocus />
        <Button title="Save" onPress={() => save.mutate(trimmed)} disabled={!trimmed} loading={save.isPending} />
      </View>
    </Sheet>
  );
}
