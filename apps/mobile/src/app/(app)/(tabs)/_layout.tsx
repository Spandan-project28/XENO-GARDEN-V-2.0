import { useQuery } from '@tanstack/react-query';
import { Tabs } from 'expo-router/tabs';
import { Bell, ChartSpline, Home, ScanLine, Settings } from 'lucide-react-native';
import { TabBar, type TabMeta } from '@/components/TabBar';
import { flags } from '@/config/flags';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export default function TabsLayout() {
  const counts = useQuery({ queryKey: qk.alertCounts, queryFn: api.alerts.counts, refetchInterval: 60_000 });
  const meta: Record<string, TabMeta> = {
    index: { icon: Home, label: 'Garden' },
    history: { icon: ChartSpline, label: 'History' },
    ...(flags.plantScan ? { scan: { icon: ScanLine, label: 'Scan' } } : {}),
    alerts: { icon: Bell, label: 'Alerts', badge: counts.data?.open ?? 0 },
    settings: { icon: Settings, label: 'Settings' },
  };
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} meta={meta} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="history" />
      <Tabs.Screen name="scan" options={flags.plantScan ? undefined : { href: null }} />
      <Tabs.Screen name="alerts" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
