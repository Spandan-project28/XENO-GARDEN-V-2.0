import { router } from 'expo-router';
import { CloudSun, Droplets, Wifi } from 'lucide-react-native';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { BrandMark } from '@/components/BrandMark';
import { useTheme } from '@/design';
import { ApiError } from '@/lib/api';
import { Banner, Button, Screen, Text } from '@/ui';
import { useStartGuest } from './hooks';

const highlights = [
  { icon: Droplets, label: 'Waters itself' },
  { icon: Wifi, label: 'Any network' },
  { icon: CloudSun, label: 'Knows the weather' },
];

/**
 * Shown only when there is no session: after signing out, or when the first launch couldn't reach
 * the server. Normally the app creates a guest session silently and skips this screen entirely.
 */
export function WelcomeScreen() {
  const t = useTheme();
  const start = useStartGuest();
  const offline =
    start.error instanceof ApiError && (start.error.code === 'NETWORK' || start.error.code === 'TIMEOUT');
  return (
    <Screen scroll={false} contentStyle={{ justifyContent: 'space-between' }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.space.xxl }}>
        <Animated.View entering={FadeInDown.duration(700)}>
          <BrandMark size={160} />
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(150).duration(700)} style={{ gap: t.space.md }}>
          <Text variant="display" align="center">
            Your garden,{'\n'}on autopilot.
          </Text>
          <Text variant="body" tone="textSecondary" align="center" style={{ maxWidth: 320, alignSelf: 'center' }}>
            Smart watering that reads the soil, respects the rain, and keeps you in the loop from anywhere.
          </Text>
        </Animated.View>
        <Animated.View
          entering={FadeInDown.delay(300).duration(700)}
          style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: t.space.sm }}
        >
          {highlights.map(({ icon: Icon, label }) => (
            <View
              key={label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: t.space.md,
                height: 32,
                borderRadius: t.radius.pill,
                backgroundColor: t.colors.surfaceGlass,
                borderWidth: 1,
                borderColor: t.colors.border,
              }}
            >
              <Icon size={14} color={t.colors.accent} />
              <Text variant="caption" tone="textSecondary">
                {label}
              </Text>
            </View>
          ))}
        </Animated.View>
      </View>
      <Animated.View entering={FadeInDown.delay(450).duration(700)} style={{ gap: t.space.md }}>
        {start.isError ? (
          <Banner
            tone="warning"
            title={offline ? 'No internet connection' : 'Couldn’t reach Xeno Garden'}
            message={
              offline
                ? 'Connect to WiFi or mobile data, then tap Get started.'
                : 'Please try again in a moment.'
            }
          />
        ) : null}
        <Button
          title="Get started"
          onPress={() => start.mutate()}
          loading={start.isPending}
          fullWidth
          testID="welcome-start"
        />
        <Button
          title="I already have an account"
          variant="secondary"
          onPress={() => router.push('/sign-in')}
          fullWidth
          testID="welcome-sign-in"
        />
      </Animated.View>
    </Screen>
  );
}
