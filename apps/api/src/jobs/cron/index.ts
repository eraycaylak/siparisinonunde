// Zamanlanmış işler (registerCron ile). Temel bakım işleri jobs/system'dedir.
// Burada: registerJobHandler(type, handler), registerCron({...}) ve onOrderTransition/onOrderCreated abonelikleri.
// Bu fonksiyon hem API hem worker sürecinde çağrılır; kayıtlar ada göre tekildir (tekrar çağrı güvenli).

export function registerCronJobs(): void {
  // Dilim doldurur.
}
