// Tüm iş işleyicileri, cron tanımları ve sipariş olayı abonelikleri. API ve worker açılışında çağrılır.

import { registerCronJobs } from './cron/index';
import { registerNotifyJobs } from './notify/index';
import { registerOrderJobs } from './order/index';
import { registerSystemJobs } from './system/index';
import { registerWaJobs } from './wa/index';

export function registerAllJobs(): void {
  registerSystemJobs();
  registerOrderJobs();
  registerWaJobs();
  registerNotifyJobs();
  registerCronJobs();
}
