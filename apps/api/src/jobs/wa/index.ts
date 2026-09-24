// WhatsApp işleri (wa.process_inbound, wa.send) — dilim 3.
// Burada: registerJobHandler(type, handler), registerCron({...}) ve onOrderTransition/onOrderCreated abonelikleri.
// Bu fonksiyon hem API hem worker sürecinde çağrılır; kayıtlar ada göre tekildir (tekrar çağrı güvenli).

export function registerWaJobs(): void {
  // Dilim doldurur.
}
