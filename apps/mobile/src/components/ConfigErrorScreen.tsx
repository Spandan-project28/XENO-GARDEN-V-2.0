import { ServerOff } from 'lucide-react-native';
import { EmptyState, Screen } from '@/ui';

/**
 * Shown only when a build was made without a server address (EXPO_PUBLIC_API_URL). End users of a
 * properly built app never see this; it prevents a silent blank app for developers.
 */
export function ConfigErrorScreen() {
  return (
    <Screen scroll={false} contentStyle={{ justifyContent: 'center' }}>
      <EmptyState
        icon={ServerOff}
        title="No server configured"
        message="This build doesn't know which Xeno Garden server to use. Set EXPO_PUBLIC_API_URL for this build profile (or run `npm run dev` for local development) and rebuild."
      />
    </Screen>
  );
}
