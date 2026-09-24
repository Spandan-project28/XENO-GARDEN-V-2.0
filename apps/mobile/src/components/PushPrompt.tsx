import { BellRing } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { useTheme } from '@/design';
import { usePushRegistration } from '@/lib/push';
import { Button, Card, Text } from '@/ui';

/**
 * Asks for notification permission at a meaningful moment (once the user has a device), with a
 * clear reason — instead of an unexplained system prompt at first launch.
 */
export function PushPrompt() {
  const t = useTheme();
  const { status, enable } = usePushRegistration();
  const [hidden, setHidden] = useState(false);
  if (hidden || (status !== 'undetermined' && status !== 'denied')) return null;

  const denied = status === 'denied';
  return (
    <Card variant="tinted" tint={t.colors.waterSoft} testID="push-prompt">
      <View style={{ flexDirection: 'row', gap: t.space.md }}>
        <BellRing size={24} color={t.colors.water} />
        <View style={{ flex: 1, gap: t.space.sm }}>
          <Text variant="subheading">{denied ? 'Alerts are turned off' : 'Get told when your garden needs you'}</Text>
          <Text variant="caption" tone="textSecondary">
            {denied
              ? 'Turn on notifications for Xeno Garden in your phone settings to hear about dry soil or a device going offline.'
              : 'We only notify you about real problems: dry soil that watering can’t fix, sensor faults or a device going offline.'}
          </Text>
          <View style={{ flexDirection: 'row', gap: t.space.sm, marginTop: t.space.xs }}>
            <Button
              title={denied ? 'Open settings' : 'Turn on alerts'}
              size="md"
              onPress={() => (denied ? void Linking.openSettings() : void enable())}
            />
            <Button title="Not now" size="md" variant="ghost" onPress={() => setHidden(true)} />
          </View>
        </View>
      </View>
    </Card>
  );
}
