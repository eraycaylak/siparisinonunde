// src/surum-yenileme.ts: container sürüm eşitleme (uygulama kontrollü yeniden başlatma; 15 §13, 17 §2.5).
// Sahte container + sahte saat + çağrı günlüğüyle KARAR mantığı ve SIRA denenir: sürüm aynı → dokunma; farklı →
// yerleşmeden sonra SIGTERM + çıkış + başlatma; işaret varsa → dokunma; APP_VERSION boş → dokunma; sağlıksız →
// dokunma; SIGTERM'den sonra ÇIKIŞ beklenmeden başlatma ÇAĞRILMAZ; destroy hiç yok. Ayrıca: imaj kanıtı (ortam yeni ama
// imaj eskiyse "tamam" yok), yedek zinciri + R2 kapısı, dağıtım kimliğiyle döngü koruması, ulaşmayan sinyal, kapanışta
// trafiğin açtığı sağlıksız yeni container, kapanış yedeği kanıtının işareti.
// Çalıştır: npm test (node --test; Node .ts dosyasındaki türleri ayıklar).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  SURUM_AYAR_VARSAYILAN,
  guncelMi,
  kapanisKaniti,
  kayitCoz,
  kisaSurum,
  saglikSurumunuOku,
  saglikYanitiniOku,
  surumEsitlemeTuru,
  surumKarari,
  yedekGuvenliginiOku,
} from '../src/surum-yenileme.ts';
import { BACKUP_TUR_HEADER, parseBackupTur, r2ProbeKey } from '../src/access.ts';

const ESKI = 'a'.repeat(40);
const YENI = 'b'.repeat(40);
const DAHA_YENI = 'c'.repeat(40);
const DK = 60_000;
const GUN = 86_400_000;

/**
 * Sahte dünya. Container SIGTERM aldıktan sonra `cikisYoklamasi` kez daha "çalışıyor" görünür, sonra çıkar
 * (Infinity = hiç çıkmaz). Kapanırken API yanıt vermez (entrypoint.sh önce uygulamaları kapatır). `imaj: undefined`
 * = sağlık ucunda `imageVersion` alanı yok (bu değişiklikten önceki imaj). `calismaSn` container'ın açılışından ölçülür.
 */
function dunya({
  hedef = YENI,
  dagitim = 'run-1',
  surum = ESKI,
  imaj = ESKI,
  calisiyor = true,
  durum = 'healthy',
  yedek = 'guvenli',
  r2Yazilir = true,
  kanit = 'goruldu',
  kayit = undefined,
  cikisYoklamasi = 2,
  sinyalUlasir = true,
  baslatBasarili = true,
  baslatinca = undefined,
  t0 = 1_000 * GUN,
} = {}) {
  const w = {
    t: t0,
    depo: kayit === undefined ? undefined : structuredClone(kayit),
    c: { calisiyor, durum, surum, imaj, sigterm: false, kalan: cikisYoklamasi, baslangicMs: t0 - GUN },
    gunluk: [],
    uyarilar: [],
    loglar: [],
    hatalar: [],
    ihlal: [],
    yedek,
    r2Yazilir,
    kanit,
    sinyalUlasir,
    baslatBasarili,
    baslatinca: baslatinca ?? { surum: hedef, imaj: hedef },
  };
  w.bag = {
    hedef,
    dagitim,
    kayitOku: async () => structuredClone(w.depo),
    kayitYaz: async (k) => {
      w.gunluk.push(`kayit:${k.asama}`);
      w.depo = structuredClone(k);
    },
    durumOku: async () => {
      if (w.c.sigterm && w.c.calisiyor) {
        if (w.c.kalan <= 0) {
          w.c.calisiyor = false;
          w.c.durum = 'stopped_with_code';
        } else w.c.kalan -= 1;
      }
      return { calisiyor: w.c.calisiyor, durum: w.c.durum };
    },
    surumOku: async () => {
      if (!w.c.calisiyor || w.c.sigterm) return { okundu: false };
      const o = { okundu: true, surum: w.c.surum, calismaSn: Math.round((w.t - w.c.baslangicMs) / 1000) };
      if (w.c.imaj !== undefined) o.imaj = w.c.imaj;
      return o;
    },
    yedekOku: async () => w.yedek,
    r2Yoklama: async () => {
      w.gunluk.push('r2');
      return w.r2Yazilir;
    },
    durdur: async () => {
      w.gunluk.push('durdur');
      if (w.c.calisiyor && w.sinyalUlasir) w.c.sigterm = true;
    },
    baslat: async () => {
      w.gunluk.push('baslat');
      if (w.c.calisiyor) w.ihlal.push('baslat çağrıldı ama eski container hâlâ çalışıyor');
      if (!w.baslatBasarili) return false;
      w.c = { calisiyor: true, durum: 'healthy', ...w.baslatinca, sigterm: false, kalan: cikisYoklamasi, baslangicMs: w.t };
      return true;
    },
    kapanisYedegi: async () => w.kanit,
    uyar: async (olay, ayrinti) => {
      w.gunluk.push(`uyar:${olay}`);
      w.uyarilar.push({ olay, ayrinti });
      return true;
    },
    bekle: async (ms) => {
      w.t += ms;
    },
    simdi: () => w.t,
    log: (s) => w.loglar.push(s),
    hata: (s) => w.hatalar.push(s),
  };
  return w;
}

/** Bir cron turu; `sonra` dk sonra çağrılır (saat ilerletilir). */
async function tur(w, sonraDk = 0) {
  w.t += sonraDk * DK;
  return surumEsitlemeTuru(w.bag);
}

const sayisi = (w, olay) => w.gunluk.filter((x) => x === olay).length;

test('APP_VERSION boş → hiçbir bağımlılık çağrılmaz, hiçbir şey yapılmaz (yerel/test)', async () => {
  for (const hedef of [undefined, '', '   ']) {
    const patla = () => {
      throw new Error('çağrılmamalıydı');
    };
    const bag = {
      hedef,
      dagitim: 'run-1',
      kayitOku: patla,
      kayitYaz: patla,
      durumOku: patla,
      surumOku: patla,
      yedekOku: patla,
      r2Yoklama: patla,
      durdur: patla,
      baslat: patla,
      kapanisYedegi: patla,
      uyar: patla,
      bekle: patla,
      simdi: () => 0,
      log: () => {},
      hata: () => {},
    };
    assert.deepEqual(await surumEsitlemeTuru(bag), { eylem: 'yok', neden: 'surum_tanimsiz' });
  }
});

test('sürüm ve imaj aynı → dokunma (kayıt yazılmaz, SIGTERM yok)', async () => {
  const w = dunya({ surum: YENI, imaj: YENI });
  assert.deepEqual(await tur(w), { eylem: 'yok', neden: 'surum_ayni' });
  assert.deepEqual(w.gunluk, []);
  assert.equal(w.depo, undefined);
});

test('farklı: ilk tur yalnız gözlem; yerleşme (4 dk) dolmadan SIGTERM gönderilmez', async () => {
  const w = dunya();
  assert.equal((await tur(w)).eylem, 'gozlem');
  assert.deepEqual(w.gunluk, ['kayit:gozlendi']);
  assert.equal(w.depo.hedef, YENI);
  assert.equal(w.depo.dagitim, 'run-1');
  assert.equal(w.depo.eskiSurum, ESKI);
  assert.equal(w.depo.deneme, 0);
  // 3 dk sonra (ör. elle tetiklenen ek tur): hâlâ beklenir — imaj push + uygulama güncellemesi penceresi
  assert.deepEqual(await tur(w, 3), { eylem: 'yok', neden: 'yerlesme_bekleniyor' });
  assert.ok(!w.gunluk.includes('durdur'));
});

test('farklı: yerleşmeden sonra yedek + R2 kapısı → kayıt → SIGTERM → çıkış beklenir → başlatılır → doğrulanır; uyarı "yenilendi"', async () => {
  const w = dunya({ cikisYoklamasi: 3 });
  await tur(w); // gözlem
  const sonuc = await tur(w, 5); // sonraki cron turu
  assert.deepEqual(sonuc, { eylem: 'tamam', neden: 'yenilendi' });
  // SIRA: R2 yoklaması → kayıt (durduruluyor) → SIGTERM → (çıkış) → başlat → kayıt (tamam) → uyarı
  assert.deepEqual(w.gunluk, ['kayit:gozlendi', 'r2', 'kayit:durduruluyor', 'durdur', 'baslat', 'kayit:tamam', 'uyar:container_surum_yenilendi']);
  assert.deepEqual(w.ihlal, [], 'başlatma eski container çıkmadan çağrılmamalı');
  assert.equal(w.depo.asama, 'tamam');
  assert.equal(w.depo.deneme, 1);
  assert.equal(w.depo.kapanisYedegi, 'goruldu');
  const { ayrinti } = w.uyarilar[0];
  assert.equal(ayrinti.eskiSurum, kisaSurum(ESKI));
  assert.equal(ayrinti.yeniSurum, kisaSurum(YENI));
  assert.equal(ayrinti.kapanisYedegi, 'goruldu');
  assert.equal(typeof ayrinti.kapanisSn, 'number');
  // Sonraki turlar: sürüm aynı → dokunma
  const once = w.gunluk.length;
  assert.deepEqual(await tur(w, 5), { eylem: 'yok', neden: 'surum_ayni' });
  assert.equal(w.gunluk.length, once);
});

test('SIGTERM\'den sonra çıkış beklenmeden başlatma ÇAĞRILMAZ; kapanış turlar boyunca sürer, çıkınca başlatılır', async () => {
  const w = dunya({ cikisYoklamasi: Infinity });
  await tur(w);
  // Tur içinde 3 dk beklenir, container çıkmaz → başlatma yok
  assert.deepEqual(await tur(w, 5), { eylem: 'bekle_cikis', neden: 'kapanis_suruyor' });
  assert.deepEqual(w.gunluk, ['kayit:gozlendi', 'r2', 'kayit:durduruluyor', 'durdur']);
  // Sonraki tur: hâlâ çalışıyor → yine bekle; YENİ SIGTERM yok (API kapalı: sinyal ulaşmış)
  assert.deepEqual(await tur(w, 5), { eylem: 'bekle_cikis', neden: 'kapanis_suruyor' });
  assert.equal(sayisi(w, 'durdur'), 1);
  assert.ok(!w.gunluk.includes('baslat'));
  // Çıkış gerçekleşir → sonraki tur başlatır
  w.c.calisiyor = false;
  w.c.durum = 'stopped_with_code';
  assert.deepEqual(await tur(w, 5), { eylem: 'tamam', neden: 'yenilendi' });
  assert.deepEqual(w.ihlal, []);
  assert.equal(sayisi(w, 'baslat'), 1);
});

test('kapanış 40 dk\'yı aşarsa vazgeçilir (en kötü meşru kapanış ≈ 34 dk erken kesilmez): uyarı, destroy/ikinci SIGTERM YOK', async () => {
  const w = dunya({ cikisYoklamasi: Infinity });
  await tur(w);
  await tur(w, 5); // SIGTERM (+3 dk bekleme) → SIGTERM'den 3 dk sonra
  // SIGTERM'den 8, 13, …, 38 dk sonra: hâlâ bekle (35 dk'da da)
  for (let i = 0; i < 7; i += 1) assert.equal((await tur(w, 5)).eylem, 'bekle_cikis', `tur ${i}`);
  assert.ok(w.t - w.depo.sigtermMs >= 35 * DK);
  const sonuc = await tur(w, 5); // SIGTERM'den ~43 dk sonra
  assert.deepEqual(sonuc, { eylem: 'vazgec', neden: 'durmadi' });
  assert.equal(w.depo.asama, 'vazgecildi');
  assert.deepEqual(w.uyarilar.map((u) => [u.olay, u.ayrinti.neden]), [['container_surum_yenilenemedi', 'durmadi']]);
  assert.equal(sayisi(w, 'durdur'), 1);
  assert.ok(!w.gunluk.includes('baslat'));
  assert.equal('destroy' in w.bag, false);
  // Sonraki turlar aynı dağıtım için bir şey yapmaz (kapanan container sürüm raporlamıyor)
  assert.equal((await tur(w, 5)).eylem, 'yok');
  assert.equal(w.uyarilar.length, 1);
});

test('işaret varsa dokunma: aynı dağıtım için deneme hakkı dolmuşsa ya da vazgeçildiyse SIGTERM yok', async () => {
  const dolu = dunya({ kayit: { hedef: YENI, dagitim: 'run-1', asama: 'gozlendi', ilkUyumsuzlukMs: 0, deneme: 2, eskiSurum: ESKI } });
  assert.deepEqual(await tur(dolu, 10), { eylem: 'vazgec', neden: 'deneme_hakki_doldu' });
  assert.ok(!dolu.gunluk.includes('durdur'));
  assert.deepEqual(await tur(dolu, 5), { eylem: 'yok', neden: 'vazgecildi' });
  assert.equal(dolu.uyarilar.length, 1, 'vazgeçme uyarısı dağıtım başına bir kez');

  const vaz = dunya({ kayit: { hedef: YENI, dagitim: 'run-1', asama: 'vazgecildi', ilkUyumsuzlukMs: 0, deneme: 1, neden: 'durmadi' } });
  assert.deepEqual(await tur(vaz, 30), { eylem: 'yok', neden: 'vazgecildi' });
  assert.deepEqual(vaz.gunluk, []);
});

test('aynı commit\'in YENİDEN DAĞITIMI (yeni DEPLOY_ID) yeni deneme hakkı alır: "vazgecildi" kaydı eski dağıtımındır', async () => {
  // run-1 vazgeçti (ör. durmadı); nöbetçi aynı commit'i Run workflow ile yeniden dağıttı → run-2
  const w = dunya({ dagitim: 'run-2', kayit: { hedef: YENI, dagitim: 'run-1', asama: 'vazgecildi', ilkUyumsuzlukMs: 0, deneme: 2, neden: 'durmadi' } });
  assert.equal((await tur(w)).eylem, 'gozlem');
  assert.equal(w.depo.dagitim, 'run-2');
  assert.equal(w.depo.deneme, 0, 'deneme sayacı yeni dağıtım için sıfırdan');
  assert.deepEqual(await tur(w, 5), { eylem: 'tamam', neden: 'yenilendi' });
  assert.equal(sayisi(w, 'durdur'), 1);
  // DEPLOY_ID'siz eski kayıt da (alan yok) yeni bir run'ın hakkını yemez
  const eski = dunya({ dagitim: 'run-3', kayit: { hedef: YENI, asama: 'vazgecildi', ilkUyumsuzlukMs: 0, deneme: 1, neden: 'eski_imaj' } });
  assert.equal((await tur(eski)).eylem, 'gozlem');
});

test('döngü koruması: yeniden başlatmadan sonra ORTAM bile farklıysa vazgeçilir, bir daha SIGTERM gönderilmez', async () => {
  const w = dunya({ baslatinca: { surum: ESKI, imaj: ESKI } });
  await tur(w);
  assert.deepEqual(await tur(w, 5), { eylem: 'vazgec', neden: 'baslatma_sonrasi_surum_farkli' });
  assert.equal(w.depo.asama, 'vazgecildi');
  for (let i = 0; i < 6; i += 1) await tur(w, 5);
  assert.equal(sayisi(w, 'durdur'), 1);
  assert.equal(w.uyarilar.filter((u) => u.olay === 'container_surum_yenilenemedi').length, 1);
});

test('İMAJ KANITI: yeniden başlatma eski imajı getirdiyse "tamam" YAZILMAZ; yerleşmeden sonra bir kez daha, yine eskiyse vazgeç', async () => {
  // Ortam (APP_VERSION) yeni Worker'dan gelir → version = YENI; imaj eski kaldı → imageVersion = ESKI
  const w = dunya({ baslatinca: { surum: YENI, imaj: ESKI } });
  await tur(w);
  assert.deepEqual(await tur(w, 5), { eylem: 'gozlem', neden: 'eski_imajla_acildi' });
  assert.equal(w.depo.asama, 'gozlendi');
  assert.equal(w.depo.deneme, 1);
  assert.ok(!w.uyarilar.some((u) => u.olay === 'container_surum_yenilendi'), 'eski imajla "yenilendi" denmemeli');
  assert.ok(w.hatalar.some((h) => h.includes('ESKİ İMAJLA')));
  // Yerleşme yeni container'dan ölçülür: 3 dk sonra hâlâ beklenir
  assert.deepEqual(await tur(w, 3), { eylem: 'yok', neden: 'yerlesme_bekleniyor' });
  // İkinci deneme de eski imaj → vazgeç (en çok 2 yeniden başlatma), uyarı bir kez
  assert.deepEqual(await tur(w, 2), { eylem: 'vazgec', neden: 'eski_imaj' });
  assert.equal(sayisi(w, 'durdur'), 2);
  assert.deepEqual(w.uyarilar.map((u) => [u.olay, u.ayrinti.neden]), [['container_surum_yenilenemedi', 'eski_imaj']]);
  for (let i = 0; i < 4; i += 1) await tur(w, 5);
  assert.equal(sayisi(w, 'durdur'), 2, 'vazgeçtikten sonra SIGTERM yok');
  assert.deepEqual(w.ihlal, []);
});

test('İMAJ KANITI: ikinci denemede imaj güncellenmişse tamam ("yenilendi", deneme 2)', async () => {
  const w = dunya({ baslatinca: { surum: YENI, imaj: ESKI } });
  await tur(w);
  await tur(w, 5); // eski imajla açıldı
  w.baslatinca = { surum: YENI, imaj: YENI }; // rollout/push bitti
  assert.deepEqual(await tur(w, 5), { eylem: 'tamam', neden: 'yenilendi' });
  assert.equal(w.depo.deneme, 2);
  assert.equal(w.uyarilar.filter((u) => u.olay === 'container_surum_yenilendi').length, 1);
});

test('ortam yeni ama imaj alanı yok/eski (push penceresinde yeniden başlamış container) → uyumsuzluk sayılır', async () => {
  for (const imaj of [undefined, null, ESKI]) {
    const w = dunya({ surum: YENI, imaj });
    assert.equal((await tur(w)).eylem, 'gozlem', String(imaj));
    assert.deepEqual(await tur(w, 5), { eylem: 'tamam', neden: 'yenilendi' }, String(imaj));
    assert.equal(sayisi(w, 'durdur'), 1);
  }
});

test('sağlıksız ya da çalışmayan container → dokunma', async () => {
  for (const durum of ['running', 'stopping', 'stopped', 'stopped_with_code']) {
    const w = dunya({ durum });
    assert.deepEqual(await tur(w), { eylem: 'yok', neden: 'saglikli_degil' }, durum);
    assert.deepEqual(w.gunluk, []);
  }
  const w = dunya({ calisiyor: false, durum: 'stopped' });
  assert.deepEqual(await tur(w), { eylem: 'yok', neden: 'container_calismiyor' });
  assert.deepEqual(w.gunluk, []);
});

test('sürüm okunamadı ya da container APP_VERSION\'sız (null) → dokunma', async () => {
  const w = dunya();
  w.bag.surumOku = async () => ({ okundu: false });
  assert.deepEqual(await tur(w), { eylem: 'yok', neden: 'surum_okunamadi' });
  const n = dunya();
  n.bag.surumOku = async () => ({ okundu: true, surum: null });
  assert.deepEqual(await tur(n), { eylem: 'yok', neden: 'surum_bilinmiyor' });
  assert.deepEqual([...w.gunluk, ...n.gunluk], []);
});

test('yedek zinciri sağlıksızsa (eskimiş ya da son tur başarısız) SIGTERM gönderilmez; uyarı kayıt başına bir kez; düzelince sürer', async () => {
  for (const [yedek, neden] of [
    ['eskimis', 'yedek_eskimis'],
    ['basarisiz', 'yedek_basarisiz'],
  ]) {
    const w = dunya({ yedek });
    await tur(w);
    assert.deepEqual(await tur(w, 5), { eylem: 'yok', neden }, yedek);
    assert.deepEqual(await tur(w, 5), { eylem: 'yok', neden }, yedek);
    assert.ok(!w.gunluk.includes('durdur'));
    assert.ok(!w.gunluk.includes('r2'), 'yedek kapısı kapalıyken R2 yoklamasına bile gerek yok');
    assert.deepEqual(w.uyarilar.map((u) => [u.olay, u.ayrinti.neden]), [['container_surum_yenilenemedi', neden]]);
    w.yedek = 'guvenli';
    assert.deepEqual(await tur(w, 5), { eylem: 'tamam', neden: 'yenilendi' });
    assert.equal(sayisi(w, 'durdur'), 1);
  }
});

test('yedek durumu bilinmiyorsa SIGTERM gönderilmez ve uyarı üretilmez (bilinmeyen durum güvenli sayılmaz)', async () => {
  const w = dunya({ yedek: 'bilinmiyor' });
  await tur(w);
  assert.deepEqual(await tur(w, 5), { eylem: 'yok', neden: 'yedek_durumu_bilinmiyor' });
  assert.ok(!w.gunluk.includes('durdur'));
  assert.equal(w.uyarilar.length, 0);
});

test('R2\'ye yazılamıyorsa (yoklama başarısız ya da hata atıyor) SIGTERM gönderilmez; uyarı bir kez', async () => {
  const w = dunya({ r2Yazilir: false });
  await tur(w);
  assert.deepEqual(await tur(w, 5), { eylem: 'yok', neden: 'r2_yazilamiyor' });
  w.bag.r2Yoklama = async () => {
    throw new Error('R2 500');
  };
  assert.deepEqual(await tur(w, 5), { eylem: 'yok', neden: 'r2_yazilamiyor' });
  assert.ok(!w.gunluk.includes('durdur'));
  assert.deepEqual(w.uyarilar.map((u) => u.ayrinti.neden), ['r2_yazilamiyor']);
});

test('eski API (backupOk alanı yok) → SINIRLI kapı: backup_stale + R2 yoklamasıyla durdurulur ve günlüğe yazılır', async () => {
  const w = dunya({ yedek: 'sinirli', imaj: undefined });
  await tur(w);
  assert.deepEqual(await tur(w, 5), { eylem: 'tamam', neden: 'yenilendi' });
  assert.ok(w.loglar.some((l) => l.includes('SINIRLI')));
  assert.ok(w.gunluk.indexOf('r2') < w.gunluk.indexOf('durdur'));
});

test('kapanış sırasında trafik yeni container\'ı açtıysa (hedef sürüm + imaj) → tamam, uyarı R2 kanıtıyla', async () => {
  const w = dunya({ cikisYoklamasi: Infinity });
  await tur(w);
  await tur(w, 5); // SIGTERM, çıkmadı
  // Eski container çıktı, araya giren bir istek (fetch yolu) yenisini YENİ ortamla başlattı
  w.c = { calisiyor: true, durum: 'healthy', surum: YENI, imaj: YENI, sigterm: false, kalan: Infinity, baslangicMs: w.t };
  assert.deepEqual(await tur(w, 5), { eylem: 'tamam', neden: 'yeni_container_ayakta' });
  assert.ok(!w.gunluk.includes('baslat'), 'başlatma zaten yapılmış');
  assert.equal(w.depo.asama, 'tamam');
  assert.equal(w.uyarilar[0].olay, 'container_surum_yenilendi');
  assert.equal(w.uyarilar[0].ayrinti.kapanisYedegi, 'goruldu');
});

test('kapanışta trafiğin açtığı yeni container SAĞLIKSIZSA (503) 40 dk beklenmez: kapanış bitti sayılır, sonraki tur doğrular', async () => {
  const w = dunya({ cikisYoklamasi: Infinity });
  await tur(w);
  await tur(w, 5); // SIGTERM
  // Eski çıktı; yenisi açıldı ama veritabanı bağlanamıyor: /health 503 (sürüm okunamaz) ama uptimeSec küçük
  const yeniBaslangic = w.t + 2 * DK;
  w.c = { calisiyor: true, durum: 'healthy', surum: YENI, imaj: YENI, sigterm: false, kalan: Infinity, baslangicMs: yeniBaslangic };
  w.bag.surumOku = async () => ({ okundu: false, calismaSn: Math.round((w.t - yeniBaslangic) / 1000) });
  const sonuc = await tur(w, 5);
  assert.deepEqual(sonuc, { eylem: 'kapanis_bitti', neden: 'trafik_yeni_container_acti' });
  assert.notEqual(sonuc.eylem, 'bekle_cikis', 'scheduled\'ın sağlık yoklaması ve tampon boşaltması atlanmamalı');
  assert.equal(w.depo.asama, 'gozlendi');
  assert.equal(w.depo.kapanisYedegi, 'goruldu');
  assert.ok(!w.gunluk.includes('baslat'));
  // Sağlıksızken olağan yol karışmaz
  assert.deepEqual(await tur(w, 5), { eylem: 'yok', neden: 'surum_okunamadi' });
  // Düzelince doğrulanır: "yenilendi", uyarı kayıttaki kapanış kanıtıyla
  w.bag.surumOku = async () => ({ okundu: true, surum: YENI, imaj: YENI, calismaSn: 600 });
  assert.deepEqual(await tur(w, 5), { eylem: 'tamam', neden: 'yenilendi' });
  assert.equal(w.uyarilar.at(-1).olay, 'container_surum_yenilendi');
  assert.equal(w.uyarilar.at(-1).ayrinti.kapanisYedegi, 'goruldu');
  assert.equal(sayisi(w, 'durdur'), 1);
});

test('SİNYAL ULAŞMADIYSA (API SIGTERM\'den 5 dk sonra hâlâ 200, süreç eski) bir kez yinelenir; yine ulaşmazsa vazgeçilir', async () => {
  const w = dunya({ sinyalUlasir: false, cikisYoklamasi: Infinity });
  await tur(w);
  assert.deepEqual(await tur(w, 5), { eylem: 'bekle_cikis', neden: 'kapanis_suruyor' }); // SIGTERM gitti(!), 3 dk beklendi
  // SIGTERM'den 3 dk sonra: henüz kanıt yok (quiesce penceresi) → bekle; burada tur 3 dk daha sürer
  // SIGTERM'den 8 dk sonra: API hâlâ 200 + süreç SIGTERM'den önce başlamış → sinyal yinelenir
  const yine = await tur(w, 5);
  assert.deepEqual(yine, { eylem: 'bekle_cikis', neden: 'kapanis_suruyor' });
  assert.equal(sayisi(w, 'durdur'), 2);
  assert.equal(w.depo.sinyalYineleme, 1);
  assert.equal(w.depo.deneme, 1, 'yineleme yeni bir yeniden başlatma denemesi değildir');
  assert.ok(w.loglar.some((l) => l.includes('sinyal ulaşmamıştı')));
  // Yine ulaşmadı → 5 dk sonra vazgeç (40 dk beklenmez); uyarı nedeni doğru
  const son = await tur(w, 5);
  assert.deepEqual(son, { eylem: 'vazgec', neden: 'sinyal_ulasmadi' });
  assert.deepEqual(w.uyarilar.map((u) => u.ayrinti.neden), ['sinyal_ulasmadi']);
  assert.equal(sayisi(w, 'durdur'), 2);
  assert.ok(!w.gunluk.includes('baslat'));
});

test('ulaşmayan sinyal yinelenince container çıkarsa olağan akış: başlatılır ve doğrulanır', async () => {
  const w = dunya({ sinyalUlasir: false, cikisYoklamasi: 1 });
  await tur(w);
  await tur(w, 5); // SIGTERM ulaşmadı
  w.sinyalUlasir = true; // DO sıfırlanmıştı; yinelenen sinyal ulaşır
  assert.deepEqual(await tur(w, 5), { eylem: 'tamam', neden: 'yenilendi' });
  assert.equal(sayisi(w, 'durdur'), 2);
  assert.equal(sayisi(w, 'baslat'), 1);
  assert.deepEqual(w.ihlal, []);
  assert.equal(w.depo.sinyalYineleme, undefined, 'tamam kaydında yineleme sayacı taşınmaz');
});

test('kapanış yedeği R2\'de görülmediyse yine başlatılır (eski disk gitti, beklemek veriyi getirmez) ama hata yazılır ve uyarıda görünür', async () => {
  for (const kanit of ['gorulmedi', 'belirsiz', 'bilinmiyor']) {
    const w = dunya({ kanit });
    await tur(w);
    assert.deepEqual(await tur(w, 5), { eylem: 'tamam', neden: 'yenilendi' });
    assert.equal(w.hatalar.some((h) => h.includes('GÖRÜLMEDİ')), kanit === 'gorulmedi', kanit);
    assert.equal(w.uyarilar[0].ayrinti.kapanisYedegi, kanit);
  }
});

test('başlatılamazsa kayıt "durduruluyor" kalır; sonraki tur yeniden SIGTERM göndermeden yalnız başlatmayı dener', async () => {
  const w = dunya({ baslatBasarili: false });
  await tur(w);
  assert.deepEqual(await tur(w, 5), { eylem: 'baslat', neden: 'baslatilamadi' });
  assert.equal(w.depo.asama, 'durduruluyor');
  w.baslatBasarili = true;
  assert.deepEqual(await tur(w, 5), { eylem: 'tamam', neden: 'yenilendi' });
  assert.equal(sayisi(w, 'durdur'), 1);
  assert.equal(sayisi(w, 'baslat'), 2);
  assert.deepEqual(w.ihlal, []);
});

test('yeni dağıtım (hedef değişti) gözlemi sıfırlar: yeni hedef için yerleşme baştan beklenir', async () => {
  const w = dunya();
  await tur(w); // YENI için gözlem
  w.bag.hedef = DAHA_YENI; // 3 dk sonra yeni dağıtım: DO yeni env ile
  w.bag.dagitim = 'run-2';
  assert.equal((await tur(w, 3)).eylem, 'gozlem');
  assert.equal(w.depo.hedef, DAHA_YENI);
  assert.equal(w.depo.dagitim, 'run-2');
  assert.deepEqual(await tur(w, 2), { eylem: 'yok', neden: 'yerlesme_bekleniyor' });
  w.baslatinca = { surum: DAHA_YENI, imaj: DAHA_YENI };
  assert.deepEqual(await tur(w, 5), { eylem: 'tamam', neden: 'yenilendi' });
  assert.equal(sayisi(w, 'durdur'), 1);
});

test('başlatma sonrası sürüm henüz okunamıyorsa (veritabanı açılıyor) sonraki tur doğrular', async () => {
  const w = dunya();
  await tur(w);
  const asil = w.bag.surumOku;
  let ilk = true;
  w.bag.surumOku = async () => {
    if (w.gunluk.includes('baslat') && ilk) {
      ilk = false;
      return { okundu: false };
    }
    return asil();
  };
  assert.deepEqual(await tur(w, 5), { eylem: 'baslat', neden: 'surum_dogrulanamadi' });
  assert.equal(w.depo.asama, 'gozlendi');
  assert.equal(w.depo.ilkUyumsuzlukMs, w.t, 'yerleşme yeni container\'dan ölçülür');
  assert.deepEqual(await tur(w, 5), { eylem: 'tamam', neden: 'yenilendi' });
  assert.equal(sayisi(w, 'durdur'), 1);
});

test('saf karar: kapanış aşaması hedeften bağımsız; farklı bir container ayaktaysa kapanış bitti sayılır', () => {
  const ayar = SURUM_AYAR_VARSAYILAN;
  const kapanan = { hedef: YENI, dagitim: 'run-1', asama: 'durduruluyor', ilkUyumsuzlukMs: 0, deneme: 1, sigtermMs: 10 * DK, eskiSurum: ESKI };
  const g = (ek) => ({ hedef: DAHA_YENI, dagitim: 'run-2', kayit: kapanan, calisiyor: true, durum: 'healthy', okuma: { okundu: false }, simdiMs: 12 * DK, ayar, ...ek });
  // Kapanırken yeni dağıtım geldi (hedef DAHA_YENI), container hâlâ kapanıyor → yine bekle (yeni SIGTERM yok)
  assert.equal(surumKarari(g({})).eylem, 'bekle_cikis');
  // Kapanış sürerken API hâlâ (SIGTERM'den 2 dk sonra) 200 → quiesce penceresi, bekle
  assert.equal(surumKarari(g({ okuma: { okundu: true, surum: ESKI, imaj: ESKI, calismaSn: 3600 } })).eylem, 'bekle_cikis');
  // Araya trafik eski hedefle (YENI) container açtı, sonra hedef DAHA_YENI oldu → kapanış bitti, DAHA_YENI'ye taşınır
  const k = surumKarari(g({ okuma: { okundu: true, surum: YENI, imaj: YENI, calismaSn: 30 } }));
  assert.equal(k.eylem, 'kapanis_bitti');
  assert.equal(k.kayit.hedef, DAHA_YENI);
  assert.equal(k.kayit.dagitim, 'run-2');
  assert.equal(k.kayit.deneme, 0, 'başka dağıtımın denemesi bu dağıtıma sayılmaz');
  // Çıktı → başlat (hedef ne olursa olsun)
  assert.equal(surumKarari(g({ calisiyor: false, durum: 'stopped' })).eylem, 'baslat');
  // Durdurma kararı kaydı: deneme +1, SIGTERM anı, eski sürüm
  const gz = { hedef: YENI, dagitim: 'run-1', asama: 'gozlendi', ilkUyumsuzlukMs: 0, deneme: 0, eskiSurum: ESKI };
  const d = surumKarari({ hedef: YENI, dagitim: 'run-1', kayit: gz, calisiyor: true, durum: 'healthy', okuma: { okundu: true, surum: ESKI, imaj: ESKI }, simdiMs: 5 * DK, ayar });
  assert.equal(d.eylem, 'durdur');
  assert.deepEqual(d.kayit, { ...gz, asama: 'durduruluyor', sigtermMs: 5 * DK, deneme: 1, eskiSurum: ESKI });
  // Başka dağıtımın kaydı yok sayılır → gözlem
  assert.equal(surumKarari({ hedef: YENI, dagitim: 'run-9', kayit: gz, calisiyor: true, durum: 'healthy', okuma: { okundu: true, surum: ESKI, imaj: ESKI }, simdiMs: 5 * DK, ayar }).eylem, 'gozlem');
});

test('sağlık gövdesi, imaj kanıtı ve yedek gövdesi okuma (bilinmeyen biçim → okunamadı / bilinmiyor)', () => {
  assert.deepEqual(saglikSurumunuOku({ ok: true, version: ` ${YENI} ` }), { okundu: true, surum: YENI });
  assert.deepEqual(saglikSurumunuOku({ ok: true, version: YENI, imageVersion: YENI, uptimeSec: 42 }), { okundu: true, surum: YENI, imaj: YENI, calismaSn: 42 });
  assert.deepEqual(saglikSurumunuOku({ ok: true, version: YENI, imageVersion: null }), { okundu: true, surum: YENI, imaj: null });
  assert.deepEqual(saglikSurumunuOku({ ok: true, version: YENI, imageVersion: 7 }), { okundu: true, surum: YENI, imaj: null });
  assert.deepEqual(saglikSurumunuOku({ ok: true, version: null }), { okundu: true, surum: null });
  assert.deepEqual(saglikSurumunuOku({ ok: true, version: '' }), { okundu: true, surum: null });
  for (const g of [null, undefined, 'metin', 42, {}, { version: 1 }, { version: {} }]) assert.deepEqual(saglikSurumunuOku(g), { okundu: false });
  // 200 dışı: sürüm kararı yok, ama uptimeSec korunur (yeni/eski container ayrımı)
  assert.deepEqual(saglikYanitiniOku(503, { ok: false, version: YENI, imageVersion: YENI, uptimeSec: 12 }), { okundu: false, calismaSn: 12 });
  assert.deepEqual(saglikYanitiniOku(503, { code: 'FST_ERR_CLOSING' }), { okundu: false });
  assert.deepEqual(saglikYanitiniOku(200, { version: YENI, imageVersion: YENI, uptimeSec: 1 }), { okundu: true, surum: YENI, imaj: YENI, calismaSn: 1 });

  assert.equal(guncelMi({ okundu: true, surum: YENI, imaj: YENI }, YENI), true);
  assert.equal(guncelMi({ okundu: true, surum: YENI, imaj: ESKI }, YENI), false, 'imaj eski');
  assert.equal(guncelMi({ okundu: true, surum: YENI }, YENI), false, 'imaj alanı yok (eski imaj)');
  assert.equal(guncelMi({ okundu: true, surum: YENI, imaj: null }, YENI), false, 'imaja sürüm gömülmemiş');
  assert.equal(guncelMi({ okundu: false }, YENI), false);

  assert.equal(yedekGuvenliginiOku({ ok: true, warnings: [], backupOk: true }), 'guvenli');
  assert.equal(yedekGuvenliginiOku({ ok: false, warnings: ['disk_low'], backupOk: true }), 'guvenli');
  assert.equal(yedekGuvenliginiOku({ ok: true, warnings: [], backupOk: false }), 'basarisiz');
  assert.equal(yedekGuvenliginiOku({ ok: true, warnings: [], backupOk: null }), 'bilinmiyor');
  assert.equal(yedekGuvenliginiOku({ ok: true, warnings: ['backup_stale', 'memory_high'], backupOk: true }), 'eskimis');
  assert.equal(yedekGuvenliginiOku({ ok: true, warnings: [] }), 'sinirli', 'backupOk\'u tanımayan eski API');
  assert.equal(yedekGuvenliginiOku({ ok: true, warnings: ['backup_stale'] }), 'eskimis');
  for (const g of [null, undefined, 'x', {}, { warnings: 'backup_stale' }, { backupOk: true }]) assert.equal(yedekGuvenliginiOku(g), 'bilinmiyor');
});

test('kapanış yedeği kanıtı: yalnız SIGTERM\'den sonra yazılmış KAPANIŞ işaretli döküm "görüldü" (süren döngü yedeği kanıt değildir)', () => {
  const S = 10 * DK;
  assert.equal(kapanisKaniti({ yuklenmeMs: S + 1, tur: 'kapanis' }, S), 'goruldu');
  assert.equal(kapanisKaniti({ yuklenmeMs: S + 1, tur: 'dongu' }, S), 'gorulmedi', 'SIGTERM\'den sonra inen döngü yedeği: kapanış yedeği inmedi');
  assert.equal(kapanisKaniti({ yuklenmeMs: S + 1, tur: null }, S), 'belirsiz', 'işaretsiz (eski entrypoint)');
  assert.equal(kapanisKaniti({ yuklenmeMs: S - 1, tur: 'kapanis' }, S), 'gorulmedi', 'SIGTERM\'den önceki bir kapanışın dökümü');
  assert.equal(kapanisKaniti(null, S), 'gorulmedi');
  assert.equal(parseBackupTur('kapanis'), 'kapanis');
  assert.equal(parseBackupTur(' DONGU '), 'dongu');
  for (const v of [null, undefined, '', 'baska']) assert.equal(parseBackupTur(v), null);
  assert.equal(r2ProbeKey('e3/'), 'e3/saglik/surum-esitleme-yoklama');
});

test('depodaki kayıt doğrulanır: bozuk/eksik kayıt yokmuş gibi (en kötü sonuç yeniden yerleşme beklemesi)', () => {
  const iyi = {
    hedef: YENI,
    dagitim: 'run-1',
    asama: 'durduruluyor',
    ilkUyumsuzlukMs: 5,
    deneme: 1,
    sigtermMs: 9,
    sinyalYineleme: 1,
    eskiSurum: ESKI,
    kapanisYedegi: 'belirsiz',
    kapanisSn: 40,
  };
  assert.deepEqual(kayitCoz(iyi), iyi);
  // Bilinmeyen kanıt değeri ve boş dağıtım kimliği düşer, kaydın geri kalanı korunur
  const temiz = { ...iyi };
  delete temiz.kapanisYedegi;
  delete temiz.dagitim;
  assert.deepEqual(kayitCoz({ ...iyi, kapanisYedegi: 'uydurma', dagitim: '  ' }), temiz);
  for (const k of [
    null,
    undefined,
    'x',
    { ...iyi, hedef: '' },
    { ...iyi, asama: 'bilinmeyen' },
    { ...iyi, deneme: -1 },
    { ...iyi, ilkUyumsuzlukMs: 'dün' },
    { hedef: YENI, asama: 'durduruluyor', ilkUyumsuzlukMs: 5, deneme: 1 }, // SIGTERM anı yok
  ]) {
    assert.equal(kayitCoz(k), null, JSON.stringify(k));
  }
  assert.equal(kisaSurum(YENI), YENI.slice(0, 12));
  assert.equal(kisaSurum(null), '?');
});

test('durma zaman aşımı entrypoint.sh\'un EN KÖTÜ meşru kapanışının üstünde (quiesce + kilit + iki yükleme)', () => {
  const sh = readFileSync(new URL('../entrypoint.sh', import.meta.url), 'utf8');
  const sayiOku = (re, ad) => {
    const m = sh.match(re);
    assert.ok(m, `${ad} entrypoint.sh'ta bulunamadı`);
    return Number(m[1]);
  };
  const quiesce = sayiOku(/BACKUP_QUIESCE_SEC="\$\{BACKUP_QUIESCE_SEC:-(\d+)\}"/, 'BACKUP_QUIESCE_SEC');
  const kilit = sayiOku(/BACKUP_LOCK_WAIT_SEC="\$\{BACKUP_LOCK_WAIT_SEC:-(\d+)\}"/, 'BACKUP_LOCK_WAIT_SEC');
  const curl = sh.match(/curl -fsS --max-time (\d+) --retry (\d+) --retry-delay (\d+)/);
  assert.ok(curl, 'upload_backup curl satırı bulunamadı');
  const [maxTime, retry, gecikme] = curl.slice(1).map(Number);
  const yuklemeSn = (retry + 1) * maxTime + retry * gecikme; // tek yükleme
  const enKotuSn = quiesce + kilit + 2 * yuklemeSn; // db + uploads
  assert.ok(SURUM_AYAR_VARSAYILAN.durmaZamanAsimiMs > enKotuSn * 1000, `durmaZamanAsimiMs (${SURUM_AYAR_VARSAYILAN.durmaZamanAsimiMs / 60_000} dk) en kötü kapanışın (${Math.ceil(enKotuSn / 60)} dk) üstünde olmalı`);
  // Sinyal kanıtı quiesce penceresinden (API'nin kapanması) sonra gelmeli: kapanmakta olan container'a yeniden sinyal yok
  assert.ok(SURUM_AYAR_VARSAYILAN.sinyalKanitMs > (quiesce + 60) * 1000);
});

test('entrypoint.sh kapanış yedeğini İŞARETLER (force → kapanis), döngü yedeği dongu; başlık adı Worker ile aynı', () => {
  const sh = readFileSync(new URL('../entrypoint.sh', import.meta.url), 'utf8');
  assert.match(sh, new RegExp(`-H "${BACKUP_TUR_HEADER}: \\$tur"`), 'upload_backup tür başlığını göndermeli');
  assert.match(sh, /\[ "\$force" = force \] && tur=kapanis/, 'force (kapanış) yedeği kapanis olarak işaretlenmeli');
  assert.match(sh, /upload_backup db "\$dump" "\$tur"/);
  assert.match(sh, /upload_backup uploads "\$tarball" "\$tur"/);
  assert.match(sh, /backup_now force \|\| true\n {2}pg_ctl/, 'kapanış yolu force yedeği alır');
});

test('kaynak değişmezleri (src/index.ts): destroy yok, SIGTERM ile durdurur, sürümü containerFetch\'siz okur, cron önce sürüm eşitler', () => {
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.ok(!/\.destroy\s*\(/.test(src), 'index.ts container\'ı destroy() (SIGKILL) ile öldürmemeli: kapanış yedeği yarıda kalır');
  assert.match(src, /durdur: \(\) => this\.stop\('SIGTERM'\)/, 'durdurma yalnız SIGTERM olmalı');
  assert.match(src, /getTcpPort\(API_PORT\)\.fetch/, 'sürüm doğrudan porttan okunmalı (containerFetch container\'ı başlatır)');
  assert.match(src, /dagitim: this\.env\.DEPLOY_ID/, 'döngü koruması dağıtım kimliğiyle anahtarlanmalı');
  assert.match(src, /saglikYanitiniOku\(r\.status, r\.govde\)/, '503 gövdesindeki uptimeSec de okunmalı');
  assert.match(src, /r2ProbeKey\(/, 'SIGTERM öncesi R2 yoklaması yapılmalı');
  // Yedek işleyicisi türü üst veriye yazar; kanıt ona bakar
  assert.match(src, /parseBackupTur\(request\.headers\.get\(BACKUP_TUR_HEADER\)\)/);
  assert.match(src, /customMetadata: \{ tur \}/);
  assert.match(src, /kapanisKaniti\(obj \? \{ yuklenmeMs: obj\.uploaded\.getTime\(\), tur: obj\.customMetadata\?\.tur \?\? null \} : null, sigtermMs\)/);
  const sched = src.slice(src.indexOf('async scheduled('));
  const esitle = sched.indexOf('app.surumuEsitle()');
  const hazir = sched.indexOf('app.ensureReady()');
  assert.ok(esitle > 0 && hazir > 0 && esitle < hazir, 'scheduled sürüm eşitlemeyi ensureReady\'den ÖNCE çağırmalı');
  assert.match(sched, /sonuc\.eylem === 'bekle_cikis'/, 'kapanan container\'a sağlık yoklaması yapılmamalı');
});
