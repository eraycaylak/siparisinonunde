import type { Metadata } from 'next';
import { DevicePushSettingsScreen } from '@/components/push/device-push-settings';

// Bu cihazda yeni sipariş bildirimi (Web Push, 00 §10 alarm t=0; 04 §4.5): kurye hariç tüm panel rolleri.
export const metadata: Metadata = { title: 'Bu cihazda bildirimler' };

export default function Page() {
  return <DevicePushSettingsScreen />;
}
