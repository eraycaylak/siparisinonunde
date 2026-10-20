// Container sürüm eşitleme — uygulama kontrollü yeniden başlatma (15 §13 "Sürüm eşitleme"; 17 §2.5).
//
// SORUN (15.10 ve 19.10 dağıtımları): `wrangler deploy --containers-rollout=immediate` yeni Worker'ı etkinleştirip
// container uygulamasını "Modified application … SUCCESS" ile güncelliyor, ama ÇALIŞAN container örneği yerinde kalıyor
// (eski imaj, eski ortam). Duman testi 20 dk boyunca eski APP_VERSION'ı okuyup geri alma tetikliyordu. APP_VERSION imaja
// gömülü değildir: Worker vars → src/mode.ts containerEnv → AppContainer.envVars ile container BAŞLARKEN verilir; çalışan
// bir container ortamını değiştirmez (workerd çalışırken `start()`'ı reddeder). Bu modül container'ı yeni Worker'ın
// Durable Object'inden yeniden başlatmanın KARARINI verir.
//
// İMAJ KANITI (yalnız ortama güvenilmez): Cloudflare'in `default` zamanlama politikası belgesi imaj değişikliğini
// rollout'a bağlar ("new Worker code can still reach container instances on the previous image until the rollout
// finishes", containers/configuration/rollouts). Durable Object'in başlattığı yeni bir örneğin takılı bir rollout'u
// atlayıp HEDEF imajı alacağını söyleyen bir belge yoktur (o garanti yalnız `durable_object` politikasının
// "application-controlled restart" düzenindedir). Ortam (APP_VERSION) ise her başlatmada yeni Worker'dan gelir: imaj
// eski kalsa bile sağlık ucu yeni SHA'yı gösterirdi. Bu yüzden commit imaja da gömülür (Dockerfile ARG/ENV
// IMAGE_VERSION ← wrangler image_vars ← scripts/prepare-config.mjs) ve `/api/v1/health` `imageVersion` alanında
// görünür. "Güncel" = `version` VE `imageVersion` hedefe eşit (`guncelMi`). Yeniden başlatma eski imajı getirdiyse
// "tamam" YAZILMAZ: yerleşmeden sonra bir kez daha denenir, yine eskiyse vazgeçilir ve uyarı gider; duman testi de iki
// alanı birden karşılaştırır.
//
// SIRA VE VERİ GÜVENLİĞİ (en kritik kısım; kanıtlar 15 §13'te kaynak alıntısıyla):
//   1. Karar → kayıt (DO deposu, `durduruluyor`, SIGTERM anı) → SIGTERM. Kayıt sinyalden ÖNCE yazılır: R2 kanıtı
//      (`uploaded >= sigtermMs`) doğru yönde kalır ve yarıda kalan tur bir sonraki cron'da kaldığı yerden sürer.
//   2. SIGTERM'den sonra container'ın ÇIKMASI beklenir (`ctx.container.running === false`). @cloudflare/containers
//      `stop()` yalnız `container.signal(15)` çağırıp DÖNER, çıkışı beklemez; durum (`getState`) da değişmez. Bu
//      yüzden bekleme burada yapılır. Çıkmadan `baslat()` ÇAĞRILMAZ (testli). Kütüphanenin kendi başlatma yolu da
//      `if (this.container.running) return 0` ile çalışan container'ın yanına ikincisini açmaz; workerd `start()`
//      çalışırken hata atar. Yani yeni container, eski entrypoint.sh `shutdown` yolunu (döngüyü durdur → uygulamaları
//      kapat → `backup_now force` → PostgreSQL'i kapat → exit) BİTİRMEDEN açılamaz.
//   3. `destroy()` (SIGKILL) HİÇ kullanılmaz. Kapanışın bittiği dışarıdan kanıtlanamaz; `durmaZamanAsimiMs`'te
//      çıkmazsa uyarı verilir, karar nöbetçinindir (17 §2.5).
//   4. SIGTERM'den ÖNCE yedek zinciri sorulur (`/api/v1/health/worker`): `backupOk` (son yedek turu başarılı mı;
//      durum dosyasının `lastResult`/`consecutiveFailures`/`note`'u, apps/api/src/routes/health.ts
//      `backupChainOkFrom`) `true` değilse ya da `backup_stale` varsa SIGTERM GÖNDERİLMEZ: kapanış yedeği de aynı
//      nedenle yazılamayabilir ve yeni container R2'deki eski dökümden açılırdı. Kapanmadan önce de R2'ye yazılabildiği
//      bir yoklama nesnesiyle denenir. Alanı henüz tanımayan eski API'de (bu değişiklikten önceki imaj) yalnız
//      `backup_stale` + R2 yoklaması bakılır (`sinirli`; günlüğe yazılır).
//   5. Sinyal ULAŞMADIYSA (kayıt yazıldı ama DO sıfırlandı, stop() patladı): entrypoint.sh API'yi SIGTERM'den en geç
//      ~2 dk sonra kapatır. `sinyalKanitMs` sonra API hâlâ 200 veriyor ve süreç SIGTERM'den önce başlamışsa
//      (`uptimeSec`) sinyal ulaşmamıştır → bir kez yinelenir, yine olmazsa vazgeçilir (40 dk boşuna beklenmez).
//   6. Kapanış sırasında trafik YENİ bir container açtıysa (API süreci SIGTERM'den sonra başlamış) eski container
//      çıkmıştır: kapanış bitti sayılır, yeni container sağlıksız olsa bile beklenmez.
//
// YERLEŞME BEKLEMESİ: wrangler Worker'ı imajı PUSH ETMEDEN ve uygulamayı güncellemeden ÖNCE etkinleştirir (wrangler
// 4.140 `deploy`: "Uploaded" → `pushBuiltContainerImage` → `deployContainers`; 19.10 günlüğünde ~37 sn, push süresi
// ise sınırsız). Uyumsuzluk ilk görüldüğünde yalnız kaydedilir; yeniden başlatma en az `yerlesmeMs` (4 dk) sonra yapılır.
// Bu süre bir GARANTİ değildir: push daha uzun sürerse yeniden başlatma eski imajı getirebilir. Onu imaj kanıtı yakalar
// (`imageVersion` hedef değil → "tamam" yok, yerleşmeden sonra bir deneme daha).
//
// DÖNGÜ KORUMASI: aynı DAĞITIM için en çok `enCokDeneme` (2) SIGTERM; kayıt hedef (commit) + dağıtım kimliğiyle
// (DEPLOY_ID = GitHub run kimliği-denemesi) anahtarlanır, yani aynı commit'in yeniden dağıtımı yeni deneme hakkı alır.
// Hak dolunca, container çıkmazsa ya da sinyal ulaşmazsa `vazgecildi` yazılır ve uyarı gider. APP_VERSION boşsa
// (yerel/test) hiçbir şey yapılmaz; container sağlıklı değilse (`healthy` değil) karışılmaz.
//
// Saf karar (`surumKarari`) + bağımlılıkları dışarıdan verilen tur (`surumEsitlemeTuru`): scripts/surum-yenileme.test.mjs
// ile Worker çalışma zamanı olmadan denenir (node --test; yalnız silinebilir TypeScript sözdizimi, çalışma zamanı
// importu yok).

import type { UyariAyrinti, UyariOlayi } from './alert';

/** Durable Object deposundaki kaydın anahtarı (tek container örneği "main" olduğu için tek kayıt). */
export const SURUM_KAYIT_ANAHTARI = 'surumYenileme';

export interface SurumAyari {
  /** Uyumsuzluk bu kadar süredir görülmeden yeniden başlatılmaz (imaj push + uygulama güncellemesi penceresi). */
  yerlesmeMs: number;
  /** Aynı dağıtım için en çok kaç yeniden başlatma (SIGTERM) yapılır (döngü koruması). */
  enCokDeneme: number;
  /** Aynı tur içinde SIGTERM'den sonra çıkış için en çok bu kadar beklenir; çıkmazsa sonraki tur sürdürür. */
  cikisBeklemeMs: number;
  /** Çıkış yoklama aralığı. */
  yoklamaMs: number;
  /**
   * SIGTERM'den bu kadar sonra hâlâ çalışıyorsa vazgeçilir (uyarı; `destroy()` YOK). entrypoint.sh'un en kötü meşru
   * kapanışı: döngü quiesce 120 sn + uygulamalar + kilit 120 sn + veritabanı yüklemesi (curl --max-time 300
   * --retry 2 → 3 × 300 + 2 × 3 ≈ 906 sn) + görsel arşivi yüklemesi (yine ≈ 906 sn) + PostgreSQL ≈ 34 dk.
   * 40 dk bunun üstündedir (R2 yavaşken sürmekte olan bir kapanış yedeği yanlışlıkla "durmadı" sayılmasın).
   */
  durmaZamanAsimiMs: number;
  /**
   * SIGTERM'den bu kadar sonra API hâlâ 200 veriyor ve süreci SIGTERM'den önce başlamışsa sinyal ulaşmamıştır
   * (entrypoint.sh uygulamaları en geç quiesce penceresinden, ~120 sn sonra kapatır).
   */
  sinyalKanitMs: number;
  /** Ulaşmayan sinyal en çok kaç kez yinelenir. */
  enCokSinyalYineleme: number;
}

export const SURUM_AYAR_VARSAYILAN: SurumAyari = {
  yerlesmeMs: 4 * 60_000,
  enCokDeneme: 2,
  cikisBeklemeMs: 3 * 60_000,
  yoklamaMs: 2_000,
  durmaZamanAsimiMs: 40 * 60_000,
  sinyalKanitMs: 5 * 60_000,
  enCokSinyalYineleme: 1,
};

export type KayitAsamasi = 'gozlendi' | 'durduruluyor' | 'tamam' | 'vazgecildi';

/**
 * Kapanış yedeği kanıtı: `goruldu` = SIGTERM'den sonra yazılmış son.dump KAPANIŞ yedeği olarak işaretli
 * (entrypoint.sh `x-yg-yedek-turu: kapanis` → R2 customMetadata); `belirsiz` = SIGTERM'den sonra yazılmış ama işaretsiz
 * (bu değişiklikten önceki entrypoint) — döngü yedeği de olabilir; `gorulmedi` = SIGTERM'den sonra yazılmış kapanış
 * yedeği yok; `bilinmiyor` = okunamadı.
 */
export type KapanisKaniti = 'goruldu' | 'belirsiz' | 'gorulmedi' | 'bilinmiyor';

const KANITLAR: readonly KapanisKaniti[] = ['goruldu', 'belirsiz', 'gorulmedi', 'bilinmiyor'];

/** Durable Object deposundaki kalıcı işaret. Kişisel veri yoktur (yalnız commit SHA'ları, run kimliği ve zamanlar). */
export interface SurumKaydi {
  /** Kaydın ait olduğu hedef sürüm (Worker'ın env.APP_VERSION'ı). */
  hedef: string;
  /** Kaydın ait olduğu dağıtım (Worker'ın env.DEPLOY_ID'si; yoksa boş). Döngü koruması hedef + dağıtım başınadır. */
  dagitim?: string;
  asama: KayitAsamasi;
  /** Uyumsuzluğun bu hedef için (son yeniden başlatmadan sonra) ilk görüldüğü an; yerleşme beklemesi buradan ölçülür. */
  ilkUyumsuzlukMs: number;
  /** Bu dağıtım için yapılan yeniden başlatma (SIGTERM) sayısı. */
  deneme: number;
  /** Son SIGTERM'den hemen ÖNCE yazılan an (R2 kanıtı: kapanış yedeği bu andan sonra yüklenmiş olmalı). */
  sigtermMs?: number;
  /** Ulaşmadığı kanıtlanıp yinelenen SIGTERM sayısı (bu yeniden başlatma için). */
  sinyalYineleme?: number;
  /** Durdurulan container'ın raporladığı sürüm (günlük ve uyarı için). */
  eskiSurum?: string | null;
  /** `vazgecildi` nedeni. */
  neden?: string;
  /** Erteleme uyarısı (yedek zinciri / R2) bu kayıt için gönderildi mi (tekrarlanmasın). */
  yedekUyarildi?: boolean;
  /** Son kapanışın R2 kanıtı ve süresi (yeni container sonraki turda doğrulanırsa uyarıya girer). */
  kapanisYedegi?: KapanisKaniti;
  kapanisSn?: number;
}

/**
 * Çalışan container'ın `/api/v1/health` okuması. `okundu` yalnız 200 + okunabilir `version` alanıyla true olur.
 * `imaj`: `imageVersion` alanı (undefined = alan yok: bu değişiklikten önceki imaj; null = alan var, boş).
 * `calismaSn`: API sürecinin çalışma süresi (`uptimeSec`; 503 gövdesinde de vardır): SIGTERM'den önce mi sonra mı
 * başladığını ayırır.
 */
export type SurumOkumasi =
  | { okundu: false; calismaSn?: number }
  | { okundu: true; surum: string | null; imaj?: string | null; calismaSn?: number };

/**
 * Yedek zincirinin sağlığı (SIGTERM'den önce): yalnız `guvenli` ve `sinirli` iken durdurulur.
 *   guvenli   — `backupOk: true`, `backup_stale` yok.
 *   sinirli   — `backupOk` alanını tanımayan eski API; `backup_stale` yok (zayıf kapı; R2 yoklamasıyla birlikte).
 *   eskimis   — `backup_stale` var.
 *   basarisiz — `backupOk: false` (son yedek turu hata/atlandı, donmuş zincir).
 *   bilinmiyor — gövde okunamadı ya da `backupOk: null` (durum dosyası yok/bozuk).
 */
export type YedekGuvenligi = 'guvenli' | 'sinirli' | 'eskimis' | 'basarisiz' | 'bilinmiyor';

export type Eylem = 'yok' | 'gozlem' | 'durdur' | 'bekle_cikis' | 'baslat' | 'kapanis_bitti' | 'tamam' | 'vazgec';

export interface Karar {
  eylem: Eylem;
  /** Makine tarafından okunan kısa neden (günlükte ve testlerde). */
  neden: string;
  /** Tanımlıysa depoya yazılacak yeni kayıt. */
  kayit?: SurumKaydi;
}

export interface KararGirdisi {
  /** Worker'ın env.APP_VERSION'ı (kırpılmış). */
  hedef: string;
  /** Worker'ın env.DEPLOY_ID'si (kırpılmış; yoksa boş). */
  dagitim?: string;
  kayit: SurumKaydi | null;
  /** `ctx.container.running`: workerd'nin süreç görüşü (kütüphane de başlatmayı buna göre korur). */
  calisiyor: boolean;
  /** Kütüphanenin durum kaydı (`getState().status`): healthy | running | stopping | stopped | stopped_with_code. */
  durum: string;
  /** Çalışan container'ın `/api/v1/health` okuması. */
  okuma: SurumOkumasi;
  simdiMs: number;
  ayar: SurumAyari;
}

/** Günlük ve uyarı için kısa SHA (12 karakter). */
export function kisaSurum(surum: string | null | undefined): string {
  const s = (surum ?? '').trim();
  return s ? s.slice(0, 12) : '?';
}

function surumAlani(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s === '' ? null : s;
}

/**
 * `/api/v1/health` gövdesinden sürüm. Alan yoksa ya da gövde beklenmedik şekildeyse "okunamadı": karar verilmez
 * (yanlış okumayla canlı container'ı durdurmak, hiç durdurmamaktan pahalıdır). `version: null` (container APP_VERSION
 * olmadan açılmış) ayrı tutulur ve o da dokunulmaz sayılır. `imageVersion` ve `uptimeSec` varsa eklenir.
 */
export function saglikSurumunuOku(govde: unknown): SurumOkumasi {
  if (govde === null || typeof govde !== 'object') return { okundu: false };
  const o = govde as { version?: unknown; imageVersion?: unknown; uptimeSec?: unknown };
  const calismaSn = typeof o.uptimeSec === 'number' && Number.isFinite(o.uptimeSec) && o.uptimeSec >= 0 ? o.uptimeSec : undefined;
  const surum = 'version' in o ? surumAlani(o.version) : undefined;
  if (surum === undefined) return calismaSn === undefined ? { okundu: false } : { okundu: false, calismaSn };
  const okuma: SurumOkumasi = { okundu: true, surum };
  if ('imageVersion' in o) {
    const imaj = surumAlani(o.imageVersion);
    okuma.imaj = imaj === undefined ? null : imaj;
  }
  if (calismaSn !== undefined) okuma.calismaSn = calismaSn;
  return okuma;
}

/**
 * HTTP durum kodu + gövde → okuma. 200 dışı (veritabanı düştü, açılış sürüyor) sürüm kararı için yeterli değildir:
 * "okunamadı" sayılır, ama gövdedeki `uptimeSec` (503 şeması da taşır) yeni/eski container ayrımı için korunur.
 */
export function saglikYanitiniOku(status: number, govde: unknown): SurumOkumasi {
  const okuma = saglikSurumunuOku(govde);
  if (status === 200) return okuma;
  return okuma.calismaSn === undefined ? { okundu: false } : { okundu: false, calismaSn: okuma.calismaSn };
}

/** Çalışan container hedefte mi: hem ortam (`version`) hem imaj (`imageVersion`) hedefe eşit olmalı. */
export function guncelMi(okuma: SurumOkumasi, hedef: string): boolean {
  return okuma.okundu && okuma.surum === hedef && okuma.imaj === hedef;
}

/**
 * `/api/v1/health/worker` gövdesinden yedek zinciri güvenliği. Eşik kararı ucun kendisindedir (`warnings`,
 * `backupOk`; src/alert.ts `yedekDurumunuOku` ile aynı kaynak). Durum kodu bilerek sorgulanmaz: 503 (kuyruk gecikti)
 * gövdesi de aynı alanları taşır, yedek sorusu ondan bağımsızdır.
 */
export function yedekGuvenliginiOku(govde: unknown): YedekGuvenligi {
  if (govde === null || typeof govde !== 'object') return 'bilinmiyor';
  const o = govde as { warnings?: unknown; backupOk?: unknown };
  if (!Array.isArray(o.warnings)) return 'bilinmiyor';
  if (o.warnings.includes('backup_stale')) return 'eskimis';
  if (!('backupOk' in o)) return 'sinirli';
  if (o.backupOk === true) return 'guvenli';
  if (o.backupOk === false) return 'basarisiz';
  return 'bilinmiyor';
}

/**
 * R2'deki son veritabanı yedeği (`head`) → kapanış yedeği kanıtı. Yalnız SIGTERM'den SONRA yazılmış ve entrypoint.sh'un
 * KAPANIŞ yedeği olarak işaretlediği (`tur: kapanis`) döküm "görüldü" sayılır. SIGTERM'den sonra yazılmış bir DÖNGÜ
 * yedeği kapanış yedeğinin İNMEDİĞİNİ gösterir (başarılı kapanış yedeği ondan sonra yazılır ve üzerine biner);
 * işaretsiz döküm (bu değişiklikten önceki entrypoint) "belirsiz"dir.
 */
export function kapanisKaniti(nesne: { yuklenmeMs: number; tur?: string | null } | null, sigtermMs: number): KapanisKaniti {
  if (!nesne || nesne.yuklenmeMs < sigtermMs) return 'gorulmedi';
  if (nesne.tur === 'kapanis') return 'goruldu';
  if (nesne.tur === 'dongu') return 'gorulmedi';
  return 'belirsiz';
}

const ASAMALAR: readonly KayitAsamasi[] = ['gozlendi', 'durduruluyor', 'tamam', 'vazgecildi'];

function sayi(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/**
 * Depodan okunan ham değeri doğrular. Bozuk ya da eski biçimli kayıt `null` sayılır (yokmuş gibi): en kötü sonuç
 * yeniden bir yerleşme beklemesidir, yanlış bir SIGTERM değil.
 */
export function kayitCoz(ham: unknown): SurumKaydi | null {
  if (ham === null || typeof ham !== 'object') return null;
  const o = ham as Record<string, unknown>;
  const hedef = typeof o.hedef === 'string' ? o.hedef.trim() : '';
  const asama = ASAMALAR.find((a) => a === o.asama);
  const ilk = sayi(o.ilkUyumsuzlukMs);
  const deneme = sayi(o.deneme);
  if (!hedef || !asama || ilk === undefined || deneme === undefined) return null;
  const kayit: SurumKaydi = { hedef, asama, ilkUyumsuzlukMs: ilk, deneme: Math.floor(deneme) };
  if (typeof o.dagitim === 'string' && o.dagitim.trim()) kayit.dagitim = o.dagitim.trim();
  const sig = sayi(o.sigtermMs);
  if (sig !== undefined) kayit.sigtermMs = sig;
  else if (asama === 'durduruluyor') return null; // SIGTERM anı olmadan bekleme ölçülemez
  const yin = sayi(o.sinyalYineleme);
  if (yin !== undefined) kayit.sinyalYineleme = Math.floor(yin);
  if (typeof o.eskiSurum === 'string' || o.eskiSurum === null) kayit.eskiSurum = o.eskiSurum;
  if (typeof o.neden === 'string') kayit.neden = o.neden;
  if (o.yedekUyarildi === true) kayit.yedekUyarildi = true;
  const kanit = KANITLAR.find((k) => k === o.kapanisYedegi);
  if (kanit) kayit.kapanisYedegi = kanit;
  const ksn = sayi(o.kapanisSn);
  if (ksn !== undefined) kayit.kapanisSn = ksn;
  return kayit;
}

/** Kayıt bu dağıtıma mı ait (hedef commit + dağıtım kimliği). */
function buDagitimin(k: SurumKaydi | null, hedef: string, dagitim: string): k is SurumKaydi {
  return k !== null && k.hedef === hedef && (k.dagitim ?? '') === dagitim;
}

/** Kaydı şimdiki dağıtıma taşır; başka bir dağıtımın kaydıysa deneme sayacı sıfırlanır (o hak bu dağıtımın değil). */
function buDagitimaTasi(k: SurumKaydi, hedef: string, dagitim: string): SurumKaydi {
  const ayni = buDagitimin(k, hedef, dagitim);
  const yeni: SurumKaydi = { ...k, hedef, deneme: ayni ? k.deneme : 0 };
  if (dagitim) yeni.dagitim = dagitim;
  else delete yeni.dagitim;
  if (!ayni) delete yeni.yedekUyarildi;
  return yeni;
}

/** API süreci SIGTERM'den SONRA mı başladı (yani bu, durdurduğumuz container değil). 10 sn pay: yuvarlama + gecikme. */
function sigtermdenSonraBasladi(okuma: SurumOkumasi, gecenMs: number): boolean {
  return okuma.calismaSn !== undefined && okuma.calismaSn * 1000 < gecenMs - 10_000;
}

/** API süreci SIGTERM'den ÖNCE başlamış ve hâlâ 200 veriyor (yani sinyal ona ulaşmadı ya da kapanış başlamadı). */
function sigtermdenOnceBasladi200(okuma: SurumOkumasi, gecenMs: number): boolean {
  return okuma.okundu && okuma.calismaSn !== undefined && okuma.calismaSn * 1000 >= gecenMs;
}

/**
 * Tek turun KARARI (saf). Yan etki yok; tur (`surumEsitlemeTuru`) kararı uygular.
 *
 * Kapanış aşaması (`durduruluyor`) hedeften BAĞIMSIZDIR: SIGTERM almış fiziksel bir container vardır ve çıkışı
 * beklenmeden yeni bir karar verilmez (arada yeni bir dağıtım gelmiş olsa bile).
 */
export function surumKarari(g: KararGirdisi): Karar {
  const hedef = g.hedef.trim();
  if (!hedef) return { eylem: 'yok', neden: 'surum_tanimsiz' };
  const dagitim = (g.dagitim ?? '').trim();
  const { kayit, okuma, simdiMs, ayar } = g;

  if (kayit && kayit.asama === 'durduruluyor') {
    // Eski container çıktı: kapanış yolu (son yedek dahil) bitti → yeni container başlatılabilir.
    if (!g.calisiyor) return { eylem: 'baslat', neden: 'eski_container_cikti' };
    const gecen = simdiMs - (kayit.sigtermMs ?? simdiMs);
    // Çalışan, DURDURDUĞUMUZ container değil: API süreci SIGTERM'den sonra başlamış ya da durdurduğumuzdan farklı bir
    // sürüm raporluyor → eski container çıkmış, yenisini trafik (fetch yolu) açmış.
    const farkliSurum =
      okuma.okundu && okuma.surum !== null && typeof kayit.eskiSurum === 'string' && okuma.surum !== kayit.eskiSurum;
    if (sigtermdenSonraBasladi(okuma, gecen) || farkliSurum) {
      const tasinan = buDagitimaTasi(kayit, hedef, dagitim);
      if (guncelMi(okuma, hedef)) {
        return { eylem: 'tamam', neden: 'yeni_container_ayakta', kayit: { ...tasinan, asama: 'tamam' } };
      }
      // Yeni container henüz doğrulanamadı (açılıyor, sağlıksız ya da başka sürüm): kapanış bitti, olağan yola dönülür.
      // Yerleşme yeni container'dan ölçülür (yeniden başlatma eski imajı getirdiyse bir sonraki deneme beklesin).
      return { eylem: 'kapanis_bitti', neden: 'trafik_yeni_container_acti', kayit: { ...tasinan, asama: 'gozlendi', ilkUyumsuzlukMs: simdiMs } };
    }
    // Sinyal ULAŞMADI: kapanış başlasaydı API en geç ~2 dk içinde kapanırdı; süreç SIGTERM'den önce başlamış ve
    // `sinyalKanitMs` sonra hâlâ 200 veriyor.
    if (gecen > ayar.sinyalKanitMs && sigtermdenOnceBasladi200(okuma, gecen)) {
      const yinelenen = kayit.sinyalYineleme ?? 0;
      if (yinelenen < ayar.enCokSinyalYineleme) {
        return {
          eylem: 'durdur',
          neden: 'sinyal_ulasmadi',
          kayit: { ...kayit, sigtermMs: simdiMs, sinyalYineleme: yinelenen + 1, eskiSurum: okuma.okundu ? okuma.surum : kayit.eskiSurum },
        };
      }
      return { eylem: 'vazgec', neden: 'sinyal_ulasmadi', kayit: { ...kayit, asama: 'vazgecildi', neden: 'sinyal_ulasmadi' } };
    }
    if (gecen > ayar.durmaZamanAsimiMs) {
      return { eylem: 'vazgec', neden: 'durmadi', kayit: { ...kayit, asama: 'vazgecildi', neden: 'durmadi' } };
    }
    return { eylem: 'bekle_cikis', neden: 'kapanis_suruyor' };
  }
  return olaganKarar(g, hedef, dagitim);
}

function olaganKarar(g: KararGirdisi, hedef: string, dagitim: string): Karar {
  const { okuma, simdiMs, ayar } = g;
  if (!g.calisiyor) return { eylem: 'yok', neden: 'container_calismiyor' };
  if (g.durum !== 'healthy') return { eylem: 'yok', neden: 'saglikli_degil' };
  if (!okuma.okundu) return { eylem: 'yok', neden: 'surum_okunamadi' };
  if (okuma.surum === null) return { eylem: 'yok', neden: 'surum_bilinmiyor' };

  const k = buDagitimin(g.kayit, hedef, dagitim) ? g.kayit : null;
  if (guncelMi(okuma, hedef)) {
    if (k && k.asama !== 'tamam') {
      return { eylem: 'tamam', neden: k.deneme > 0 ? 'yenilendi' : 'kendiliginden_esitlendi', kayit: { ...k, asama: 'tamam' } };
    }
    return { eylem: 'yok', neden: 'surum_ayni' };
  }

  // Uyumsuzluk: çalışan container başka bir sürüm (ortam ya da imaj).
  if (k && k.asama === 'vazgecildi') return { eylem: 'yok', neden: 'vazgecildi' };
  if (k && k.deneme >= ayar.enCokDeneme) {
    return { eylem: 'vazgec', neden: 'deneme_hakki_doldu', kayit: { ...k, asama: 'vazgecildi', neden: 'deneme_hakki_doldu' } };
  }
  if (!k || k.asama === 'tamam') {
    const yeni: SurumKaydi = { hedef, asama: 'gozlendi', ilkUyumsuzlukMs: simdiMs, deneme: k ? k.deneme : 0, eskiSurum: okuma.surum };
    if (dagitim) yeni.dagitim = dagitim;
    return { eylem: 'gozlem', neden: 'uyumsuzluk_goruldu', kayit: yeni };
  }
  const gecen = simdiMs - k.ilkUyumsuzlukMs;
  if (gecen < ayar.yerlesmeMs) return { eylem: 'yok', neden: 'yerlesme_bekleniyor' };
  const durdurulacak: SurumKaydi = { ...k, asama: 'durduruluyor', sigtermMs: simdiMs, deneme: k.deneme + 1, eskiSurum: okuma.surum };
  delete durdurulacak.sinyalYineleme;
  delete durdurulacak.kapanisYedegi;
  delete durdurulacak.kapanisSn;
  return { eylem: 'durdur', neden: 'surum_farkli', kayit: durdurulacak };
}

// --- Tur (yan etkiler dışarıdan verilir) ----------------------------------------------------------------------

export interface ContainerDurumu {
  calisiyor: boolean;
  durum: string;
}

export interface SurumTuruBagimliliklari {
  /** Worker'ın env.APP_VERSION'ı. */
  hedef: string | undefined;
  /** Worker'ın env.DEPLOY_ID'si (döngü korumasının dağıtım anahtarı). */
  dagitim?: string | undefined;
  kayitOku(): Promise<unknown>;
  kayitYaz(kayit: SurumKaydi): Promise<void>;
  durumOku(): Promise<ContainerDurumu>;
  /** Çalışan container'ın `/api/v1/health` okuması. Container'ı BAŞLATMAMALI (doğrudan port; containerFetch değil). */
  surumOku(): Promise<SurumOkumasi>;
  /** SIGTERM'den önce yedek zinciri sağlığı (`/api/v1/health/worker`). */
  yedekOku(): Promise<YedekGuvenligi>;
  /** SIGTERM'den önce R2'ye gerçekten yazılabiliyor mu (yoklama nesnesi yaz + sil). */
  r2Yoklama(): Promise<boolean>;
  /** Yalnız SIGTERM gönderir (`Container.stop('SIGTERM')`); çıkışı beklemez. */
  durdur(): Promise<void>;
  /** Container'ı başlatıp portlarını bekler; açıldıysa true. */
  baslat(): Promise<boolean>;
  /** R2'deki son veritabanı yedeği `sigtermMs`'ten sonra KAPANIŞ yedeği olarak mı yazıldı (bkz. KapanisKaniti). */
  kapanisYedegi(sigtermMs: number): Promise<KapanisKaniti>;
  uyar(olay: UyariOlayi, ayrinti: UyariAyrinti): Promise<unknown>;
  bekle(ms: number): Promise<void>;
  simdi(): number;
  log?(satir: string): void;
  hata?(satir: string): void;
  ayar?: Partial<SurumAyari>;
}

export interface TurSonucu {
  eylem: Eylem;
  neden: string;
}

function calisanMetni(okuma: SurumOkumasi): string {
  if (!okuma.okundu) return ' calisan=?';
  const imaj = okuma.imaj === undefined ? 'alan_yok' : kisaSurum(okuma.imaj);
  return ` calisan=${kisaSurum(okuma.surum)} imaj=${imaj}`;
}

const ERTELEME_NEDENI: Record<Exclude<YedekGuvenligi, 'guvenli' | 'sinirli'>, string> = {
  eskimis: 'yedek_eskimis',
  basarisiz: 'yedek_basarisiz',
  bilinmiyor: 'yedek_durumu_bilinmiyor',
};

async function kanitOku(d: SurumTuruBagimliliklari, sigtermMs: number | undefined): Promise<KapanisKaniti> {
  if (sigtermMs === undefined) return 'bilinmiyor';
  return d.kapanisYedegi(sigtermMs).catch((): KapanisKaniti => 'bilinmiyor');
}

/**
 * Tek tur: kararı verir ve uygular. Bağımlılık hatası çağırana (scheduled) çıkar ve oradaki try günlüğe yazar;
 * kayıt her adımdan önce yazıldığı için bir sonraki tur kaldığı yerden sürer.
 */
export async function surumEsitlemeTuru(d: SurumTuruBagimliliklari): Promise<TurSonucu> {
  const ayar: SurumAyari = { ...SURUM_AYAR_VARSAYILAN, ...(d.ayar ?? {}) };
  const log = d.log ?? ((s: string) => console.log(s));
  const hata = d.hata ?? ((s: string) => console.error(s));
  const hedef = (d.hedef ?? '').trim();
  const dagitim = (d.dagitim ?? '').trim();
  const bitir = (eylem: Eylem, neden: string, ek = ''): TurSonucu => {
    log(`sürüm eşitleme: ${eylem} (${neden}) hedef=${kisaSurum(hedef)}${ek}`);
    return { eylem, neden };
  };
  // APP_VERSION yoksa (yerel/test) hiçbir şey OKUNMAZ ve yapılmaz.
  if (!hedef) return { eylem: 'yok', neden: 'surum_tanimsiz' };

  const kayit = kayitCoz(await d.kayitOku());
  const durum = await d.durumOku();
  const okuma: SurumOkumasi = durum.calisiyor ? await d.surumOku() : { okundu: false };
  const calisan = calisanMetni(okuma);
  const karar = surumKarari({ hedef, dagitim, kayit, calisiyor: durum.calisiyor, durum: durum.durum, okuma, simdiMs: d.simdi(), ayar });

  switch (karar.eylem) {
    case 'yok':
    case 'bekle_cikis':
      return bitir(karar.eylem, karar.neden, calisan);

    case 'gozlem':
      await d.kayitYaz(karar.kayit as SurumKaydi);
      return bitir('gozlem', karar.neden, `${calisan}; yeniden başlatma en erken ${Math.round(ayar.yerlesmeMs / 60_000)} dk sonra (imaj push penceresi)`);

    case 'kapanis_bitti': {
      // Eski container çıktı, yenisini trafik açtı ama henüz doğrulanamadı: kanıt kaydedilir, sonraki tur doğrular.
      const kanit = await kanitOku(d, kayit?.sigtermMs);
      const kapanisSn = kayit?.sigtermMs === undefined ? undefined : Math.round((d.simdi() - kayit.sigtermMs) / 1000);
      const yeni: SurumKaydi = { ...(karar.kayit as SurumKaydi), kapanisYedegi: kanit };
      if (kapanisSn !== undefined) yeni.kapanisSn = kapanisSn;
      await d.kayitYaz(yeni);
      if (kanit === 'gorulmedi') {
        hata(`sürüm eşitleme: kapanış yedeği R2'de GÖRÜLMEDİ (SIGTERM'den sonra yazılmış kapanış dökümü yok); container günlüğünde [ERROR] satırlarına bakın — docs/17 §2.5`);
      }
      return bitir('kapanis_bitti', karar.neden, `${calisan}; kapanis_yedegi=${kanit}; yeni container sonraki turda doğrulanacak`);
    }

    case 'tamam': {
      const yeni = karar.kayit as SurumKaydi;
      let ek = '';
      if (kayit && kayit.asama === 'durduruluyor' && kayit.sigtermMs !== undefined) {
        const kanit = await kanitOku(d, kayit.sigtermMs);
        const kapanisSn = Math.round((d.simdi() - kayit.sigtermMs) / 1000);
        ek = `; kapanis_yedegi=${kanit}`;
        await d.kayitYaz({ ...yeni, kapanisYedegi: kanit, kapanisSn });
        await d.uyar('container_surum_yenilendi', { eskiSurum: kisaSurum(kayit.eskiSurum), yeniSurum: kisaSurum(hedef), kapanisSn, kapanisYedegi: kanit });
      } else {
        await d.kayitYaz(yeni);
        if (yeni.deneme > 0) {
          const ayrinti: UyariAyrinti = { eskiSurum: kisaSurum(yeni.eskiSurum), yeniSurum: kisaSurum(hedef) };
          if (yeni.kapanisYedegi) ayrinti.kapanisYedegi = yeni.kapanisYedegi;
          if (yeni.kapanisSn !== undefined) ayrinti.kapanisSn = yeni.kapanisSn;
          await d.uyar('container_surum_yenilendi', ayrinti);
        }
      }
      return bitir('tamam', karar.neden, `${calisan}${ek}`);
    }

    case 'vazgec': {
      await d.kayitYaz(karar.kayit as SurumKaydi);
      hata(`sürüm eşitleme: VAZGEÇİLDİ (${karar.neden}) hedef=${kisaSurum(hedef)}${calisan} — container yeniden başlatılmıyor, elle bakın (docs/17 §2.5)`);
      await d.uyar('container_surum_yenilenemedi', { neden: karar.neden, hedef: kisaSurum(hedef), calisan: okuma.okundu ? kisaSurum(okuma.surum) : '?' });
      return { eylem: 'vazgec', neden: karar.neden };
    }

    case 'durdur': {
      const aday = karar.kayit as SurumKaydi;
      // Kapı 1: yedek zinciri. Son yedek turu başarılı değilse SIGTERM GÖNDERİLMEZ (kapanış yedeği de yazılamayabilir;
      // yeni container R2'deki eski dökümden açılırdı → veri kaybı).
      const yedek = await d.yedekOku();
      let erteleme: string | null = yedek === 'guvenli' || yedek === 'sinirli' ? null : ERTELEME_NEDENI[yedek];
      // Kapı 2: R2'ye şu an yazılabiliyor mu (kapanış yedeği aynı yoldan gider). Hata = yazılamıyor.
      if (!erteleme && !(await d.r2Yoklama().catch(() => false))) erteleme = 'r2_yazilamiyor';
      if (erteleme) {
        hata(`sürüm eşitleme: ERTELENDİ (${erteleme}) hedef=${kisaSurum(hedef)}${calisan} — kapanış yedeği güvencesiz, container durdurulmadı`);
        // Bilinmeyen durum alarm değildir (API açılıyor olabilir); diğerleri kayıt başına BİR kez bildirilir.
        if (erteleme !== 'yedek_durumu_bilinmiyor' && kayit && !kayit.yedekUyarildi) {
          await d.kayitYaz({ ...kayit, yedekUyarildi: true });
          await d.uyar('container_surum_yenilenemedi', { neden: erteleme, hedef: kisaSurum(hedef), calisan: kisaSurum(aday.eskiSurum) });
        }
        return { eylem: 'yok', neden: erteleme };
      }
      if (yedek === 'sinirli') {
        log(`sürüm eşitleme: yedek kapısı SINIRLI (çalışan API backupOk alanını tanımıyor; yalnız backup_stale + R2 yoklaması denetlendi)`);
      }
      // Kayıt SİNYALDEN ÖNCE: SIGTERM anı R2 kanıtının alt sınırıdır; tur yarıda kalırsa sonraki tur sürdürür.
      const sigtermMs = d.simdi();
      const kapanan: SurumKaydi = { ...aday, sigtermMs };
      await d.kayitYaz(kapanan);
      await d.durdur();
      const yineleme = karar.neden === 'sinyal_ulasmadi' ? ` (sinyal ulaşmamıştı, yineleme ${kapanan.sinyalYineleme}/${ayar.enCokSinyalYineleme})` : '';
      log(`sürüm eşitleme: SIGTERM gönderildi${yineleme} (deneme ${kapanan.deneme}/${ayar.enCokDeneme}) eski=${kisaSurum(aday.eskiSurum)} hedef=${kisaSurum(hedef)}; çıkış bekleniyor`);
      // Çıkış beklenir: `running` false olmadan başlatma YOK.
      const sinir = sigtermMs + ayar.cikisBeklemeMs;
      let calisiyor = true;
      while (d.simdi() < sinir) {
        await d.bekle(ayar.yoklamaMs);
        calisiyor = (await d.durumOku()).calisiyor;
        if (!calisiyor) break;
      }
      if (calisiyor) return bitir('bekle_cikis', 'kapanis_suruyor', `; ${Math.round(ayar.cikisBeklemeMs / 1000)} sn içinde çıkmadı, sonraki tur sürdürecek`);
      return baslatVeDogrula(d, kapanan, hedef, dagitim, ayar, log, hata);
    }

    case 'baslat':
      return baslatVeDogrula(d, kayit as SurumKaydi, hedef, dagitim, ayar, log, hata);
  }
}

async function baslatVeDogrula(
  d: SurumTuruBagimliliklari,
  k: SurumKaydi,
  hedef: string,
  dagitim: string,
  ayar: SurumAyari,
  log: (s: string) => void,
  hata: (s: string) => void,
): Promise<TurSonucu> {
  const sigtermMs = k.sigtermMs ?? d.simdi();
  const kapanisSn = Math.round((d.simdi() - sigtermMs) / 1000);
  // Kanıt: kapanış yedeği R2'ye yazıldı mı. Başlatmayı ENGELLEMEZ: eski container'ın diski çıkışla birlikte gitti,
  // beklemek veriyi geri getirmez, yalnız siteyi kapalı tutar (taze açılış/donmuş zincirde yazılmaması da olağandır).
  // SIGTERM'i engelleyen asıl kapı yukarıdaki yedek zinciri + R2 yoklamasıdır.
  const kanit = await kanitOku(d, sigtermMs);
  if (kanit === 'gorulmedi') {
    hata(`sürüm eşitleme: kapanış yedeği R2'de GÖRÜLMEDİ (SIGTERM'den sonra yazılmış kapanış dökümü yok); container günlüğünde [ERROR] satırlarına bakın — docs/17 §2.5`);
  }
  log(`sürüm eşitleme: eski container çıktı (${kapanisSn} sn, kapanis_yedegi=${kanit}); yeni container başlatılıyor`);
  if (!(await d.baslat())) {
    // Kayıt `durduruluyor` kalır: sonraki tur başlatmayı yeniden dener (container zaten durmuş; çalışan bir şey yok).
    hata(`sürüm eşitleme: yeni container başlatılamadı; sonraki tur yeniden deneyecek`);
    return { eylem: 'baslat', neden: 'baslatilamadi' };
  }
  const tasinan: SurumKaydi = { ...buDagitimaTasi(k, hedef, dagitim), kapanisYedegi: kanit, kapanisSn };
  delete tasinan.sinyalYineleme;
  const okuma = await d.surumOku();
  if (guncelMi(okuma, hedef)) {
    await d.kayitYaz({ ...tasinan, asama: 'tamam' });
    await d.uyar('container_surum_yenilendi', { eskiSurum: kisaSurum(k.eskiSurum), yeniSurum: kisaSurum(hedef), kapanisSn, kapanisYedegi: kanit });
    log(`sürüm eşitleme: tamam (yenilendi) hedef=${kisaSurum(hedef)}`);
    return { eylem: 'tamam', neden: 'yenilendi' };
  }
  if (!okuma.okundu) {
    // Portlar açık ama sürüm okunamadı (veritabanı açılıyor olabilir): olağan yola dön, sonraki tur doğrular.
    // Yerleşme yeni container'dan ölçülür: eski imajla açıldıysa bir sonraki deneme beklesin.
    await d.kayitYaz({ ...tasinan, asama: 'gozlendi', ilkUyumsuzlukMs: d.simdi() });
    log(`sürüm eşitleme: yeni container açıldı, sürüm henüz okunamadı; sonraki tur doğrulayacak`);
    return { eylem: 'baslat', neden: 'surum_dogrulanamadi' };
  }
  if (okuma.surum === hedef) {
    // Ortam yeni ama İMAJ eski (push/rollout bitmemiş): "tamam" YAZILMAZ. Hak varsa yerleşmeden sonra bir kez daha.
    if (tasinan.deneme < ayar.enCokDeneme) {
      await d.kayitYaz({ ...tasinan, asama: 'gozlendi', ilkUyumsuzlukMs: d.simdi(), eskiSurum: okuma.surum });
      hata(
        `sürüm eşitleme: yeni container ESKİ İMAJLA açıldı (imaj=${okuma.imaj === undefined ? 'alan_yok' : kisaSurum(okuma.imaj)}, hedef=${kisaSurum(hedef)}); ` +
          `en erken ${Math.round(ayar.yerlesmeMs / 60_000)} dk sonra bir kez daha denenecek (deneme ${tasinan.deneme}/${ayar.enCokDeneme})`,
      );
      return { eylem: 'gozlem', neden: 'eski_imajla_acildi' };
    }
    await d.kayitYaz({ ...tasinan, asama: 'vazgecildi', neden: 'eski_imaj' });
    hata(`sürüm eşitleme: VAZGEÇİLDİ (eski_imaj) hedef=${kisaSurum(hedef)} — ${tasinan.deneme} yeniden başlatmada da imaj güncellenmedi; docs/17 §2.5`);
    await d.uyar('container_surum_yenilenemedi', { neden: 'eski_imaj', hedef: kisaSurum(hedef), calisan: kisaSurum(okuma.surum), imaj: okuma.imaj === undefined ? 'alan_yok' : kisaSurum(okuma.imaj) });
    return { eylem: 'vazgec', neden: 'eski_imaj' };
  }
  // Yeniden başlatıldı ama ORTAM bile hedef değil (APP_VERSION boş/başka geldi): döngüye girmeden vazgeç.
  await d.kayitYaz({ ...tasinan, asama: 'vazgecildi', neden: 'baslatma_sonrasi_surum_farkli' });
  hata(`sürüm eşitleme: VAZGEÇİLDİ (baslatma_sonrasi_surum_farkli) hedef=${kisaSurum(hedef)} calisan=${kisaSurum(okuma.surum)} — docs/17 §2.5`);
  await d.uyar('container_surum_yenilenemedi', { neden: 'baslatma_sonrasi_surum_farkli', hedef: kisaSurum(hedef), calisan: kisaSurum(okuma.surum) });
  return { eylem: 'vazgec', neden: 'baslatma_sonrasi_surum_farkli' };
}
