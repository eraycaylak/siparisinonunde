// Sipariş işleri (order.alarm_step, order.received_debounced, order.finalize_rejection, order.awaiting_timeout, order.notify_customer) — dilim 2.
// Burada: registerJobHandler(type, handler), registerCron({...}) ve onOrderTransition/onOrderCreated abonelikleri.
// Bu fonksiyon hem API hem worker sürecinde çağrılır; kayıtlar ada göre tekildir (tekrar çağrı güvenli).

export function registerOrderJobs(): void {
  // Dilim doldurur.
}
