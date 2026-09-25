// Bildirim işleri (order.received_debounced, order.notify_customer, platform.alert, sms.send, push.send) ve sipariş
// olayı abonelikleri (registerMessagingHooks) — dilim 3; push.send: 00 §10 alarm t=0 Web Push.
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
import { handlePushSend, PUSH_SEND_JOB, type PushSendPayload } from '../../services/push/send';

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

  // Yeni sipariş Web Push (t=0): şubeye erişen panel kullanıcılarının cihazları (ana şerit; istek başına 10 sn üst süre)
  registerJobHandler<PushSendPayload>(PUSH_SEND_JOB, async (payload, { db, config, log }) => {
    if (!payload.orderId || !payload.tenantId) return;
    const res = await handlePushSend({ db, config, log }, payload);
    if (res.status === 'sent') log.info({ orderId: payload.orderId, sent: res.sent, disabled: res.disabled, retrying: res.retrying }, 'push gönderildi');
  });

  // Sipariş olayları → müşteri mesajları (onOrderCreated / onOrderTransition)
  registerMessagingHooks();
}
