// Bildirim işleri (order.received_debounced, order.notify_customer, platform.alert, sms.send) ve sipariş olayı
// abonelikleri (registerMessagingHooks) — dilim 3.
// Bu fonksiyon hem API hem worker sürecinde çağrılır (jobs/index.ts → registerAllJobs; app.ts ve worker.ts);
// kayıtlar ada göre tekildir (tekrar çağrı güvenli).

import { registerJobHandler } from '../../lib/jobs';
import {
  handleNotifyCustomer,
  handleReceivedDebounced,
  registerMessagingHooks,
  type NotifyCustomerPayload,
} from '../../services/messaging/order-notify';
import { handlePlatformAlert, type PlatformAlertPayload } from '../../services/messaging/platform-alert';
import { handleSmsSend, type SmsSendPayload } from '../../services/messaging/sms-send';

export function registerNotifyJobs(): void {
  // Akış A: "alındı" 60 sn debounce (onay gelirse iş iptal edilir → birleşik M06c)
  registerJobHandler<{ orderId: string }>('order.received_debounced', async (payload, { db, config, log }) => {
    if (!payload.orderId) return;
    await handleReceivedDebounced({ db, config, log }, payload.orderId);
  });

  // Durum bildirimi / onay gecikmesi (M13) / gecikme bildirimi (M34)
  registerJobHandler<NotifyCustomerPayload>('order.notify_customer', async (payload, { db, config, log }) => {
    if (!payload.orderId) return;
    await handleNotifyCustomer({ db, config, log }, { ...payload, event: payload.event ?? 'status' });
  });

  // Platform WhatsApp numarasından işletme sahibine uyarı
  registerJobHandler<PlatformAlertPayload>('platform.alert', async (payload, { db, config, log }) => {
    if (!payload.tenantId || !payload.kind) return;
    await handlePlatformAlert({ db, config, log }, payload);
  });

  // SMS (OTP, kritik durum, alarm)
  registerJobHandler<SmsSendPayload>('sms.send', async (payload, { db, config, log, job }) => {
    if (!payload.to || !payload.body) return;
    await handleSmsSend({ db, config, log, lastAttempt: job.attempts >= job.maxAttempts }, payload);
  });

  // Sipariş olayları → müşteri mesajları (onOrderCreated / onOrderTransition)
  registerMessagingHooks();
}
