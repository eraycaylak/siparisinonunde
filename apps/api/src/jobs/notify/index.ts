// Bildirim işleri (sms.send, platform.alert) — dilim 2/3.
// Burada: registerJobHandler(type, handler), registerCron({...}) ve onOrderTransition/onOrderCreated abonelikleri.
// Bu fonksiyon hem API hem worker sürecinde çağrılır; kayıtlar ada göre tekildir (tekrar çağrı güvenli).

export function registerNotifyJobs(): void {
  // Dilim doldurur.
}
