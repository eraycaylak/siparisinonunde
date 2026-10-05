// src/webhook-spool.ts + src/alert.ts: gelen webhook tamponu ve sırayla geri verme (denetim 2026-10-04 madde 1.7/B8)
// + yedek gözcüsü (denetim 2026-10-05 bulgu B: yedek ölürse haber veren kanal yoktu).
// Çalıştır: npm test (node --test; Node .ts dosyasındaki türleri ayıklar).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  YEDEK_UYARI_SOGUMA_MS,
  uyariGonder,
  uyariGovdesi,
  yedekDurumunuOku,
  yedekUyariAyrinti,
  yedekUyarisiGerekir,
} from '../src/alert.ts';
import {
  DRAIN_HEADER,
  MAX_SPOOL_BYTES,
  REPLAY_HEADER,
  STORED_HEADERS,
  drainSpool,
  markerKey,
  maskWebhookPath,
  parseRecord,
  recordBody,
  recordKey,
  replayRequest,
  runDrain,
  shouldSpool,
  spoolDir,
  spoolPrefix,
  spoolWebhook,
  tamponaAlVeOnayla,
} from '../src/webhook-spool.ts';

const EPOCH = '3';
const YOL = '/api/v1/webhooks/wa/shared/gizlibelirtec123';
const TWILIO_BODY = 'From=whatsapp%3A%2B905321234567&Body=merhaba&MessageSid=SM123';

/** Bellekte R2 taklidi: put/head/get/delete/list (anahtarlar sözlük sırasında döner). */
function fakeBucket() {
  const store = new Map();
  return {
    store,
    async put(key, value, opts) {
      store.set(key, { value, opts });
      return { key };
    },
    async head(key) {
      return store.has(key) ? { key } : null;
    },
    async get(key) {
      const kayit = store.get(key);
      if (!kayit) return null;
      return { key, text: async () => String(kayit.value) };
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = '', limit = 1000 } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      return { objects: keys.slice(0, limit).map((key) => ({ key })), truncated: keys.length > limit };
    },
  };
}

const govdeOf = (metin) => new TextEncoder().encode(metin).buffer;

const twilioIstek = (body = TWILIO_BODY, yol = YOL) => ({
  yontem: 'POST',
  yol,
  basliklar: new Headers({
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'x-twilio-signature': 'ImZaYmFzSWd6YQ==',
    'cf-connecting-ip': '203.0.113.7',
    cookie: 'oturum=gizli',
    authorization: 'Basic Z2l6bGk=',
    'content-length': String(body.length),
  }),
  govde: govdeOf(body),
});

test('anahtarlar dönem önekli, sıralı ve tekil; geçersiz dönem öneksiz kalır', () => {
  assert.equal(spoolPrefix('3'), 'e3/');
  assert.equal(spoolPrefix(''), '');
  assert.equal(spoolPrefix('../x'), '');
  assert.equal(spoolDir(EPOCH), 'e3/webhook-tampon/');
  // Gizli staging ile canlı ortam aynı kovayı paylaşır: önek karışmayı engeller
  assert.notEqual(spoolDir('3'), spoolDir('901'));
  const erken = recordKey(EPOCH, 1_700_000_000_000, 'a'.repeat(64));
  const gec = recordKey(EPOCH, 1_700_000_000_001, 'b'.repeat(64));
  assert.ok(erken < gec, 'zaman sırası anahtar sırasıyla aynı olmalı');
  assert.notEqual(erken, recordKey(EPOCH, 1_700_000_000_000, 'c'.repeat(64)));
  // Mühür, kayıt listesine karışmaz (farklı klasör)
  assert.equal(markerKey(EPOCH, 'a'.repeat(64)).startsWith(spoolDir(EPOCH)), false);
  // Anahtarda belirteç YOK (yalnız zaman + özet)
  assert.equal(erken.includes('gizlibelirtec'), false);
});

test('log ve uyarılarda webhook belirteci maskelenir', () => {
  assert.equal(maskWebhookPath(YOL), '/api/v1/webhooks/wa/shared/••••');
  assert.equal(maskWebhookPath('/api/v1/webhooks/wa/abc123?x=1'), '/api/v1/webhooks/wa/••••');
});

test('tampona yazma: imza başlıkları aynen saklanır, çerez/authorization saklanmaz', async () => {
  const bucket = fakeBucket();
  const sonuc = await spoolWebhook({ bucket, epoch: EPOCH, now: 1_700_000_000_000 }, twilioIstek());
  assert.equal(sonuc.yeni, true);

  const kayit = parseRecord(await (await bucket.get(sonuc.anahtar)).text());
  assert.ok(kayit);
  assert.equal(kayit.yol, YOL, 'Twilio imzası adres üzerinden hesaplanır: yol birebir korunmalı');
  assert.equal(kayit.yontem, 'POST');
  assert.equal(kayit.basliklar['x-twilio-signature'], 'ImZaYmFzSWd6YQ==');
  assert.equal(kayit.basliklar['content-type'], 'application/x-www-form-urlencoded; charset=UTF-8');
  assert.equal(kayit.basliklar['cf-connecting-ip'], '203.0.113.7');
  assert.equal('cookie' in kayit.basliklar, false);
  assert.equal('authorization' in kayit.basliklar, false);
  assert.equal('content-length' in kayit.basliklar, false);
  // Ham gövde bayt bayt korunur
  assert.equal(new TextDecoder().decode(recordBody(kayit)), TWILIO_BODY);
  assert.equal(STORED_HEADERS.includes('x-hub-signature-256'), true, 'Meta imzası da saklanmalı');
});

test('aynı istek iki kez yazılmaz (idempotent); farklı gövde ayrı kayıt olur', async () => {
  const bucket = fakeBucket();
  const birinci = await spoolWebhook({ bucket, epoch: EPOCH, now: 1_700_000_000_000 }, twilioIstek());
  const boyut = bucket.store.size;
  // Sağlayıcı aynı gövdeyi 30 sn sonra yeniden teslim etti
  const ikinci = await spoolWebhook({ bucket, epoch: EPOCH, now: 1_700_000_030_000 }, twilioIstek());
  assert.equal(ikinci.yeni, false);
  assert.equal(ikinci.ozet, birinci.ozet);
  assert.equal(bucket.store.size, boyut, 'ikinci kopya yazılmamalı');

  const farkli = await spoolWebhook({ bucket, epoch: EPOCH, now: 1_700_000_060_000 }, twilioIstek('MessageSid=SM999'));
  assert.equal(farkli.yeni, true);
  assert.equal(bucket.store.size, boyut + 2, 'yeni kayıt + yeni mühür');
});

test('çok büyük gövde tampona alınmaz (hata atar; çağıran 200 dönmez)', async () => {
  const bucket = fakeBucket();
  const buyuk = { ...twilioIstek(), govde: new ArrayBuffer(MAX_SPOOL_BYTES + 1) };
  await assert.rejects(() => spoolWebhook({ bucket, epoch: EPOCH }, buyuk), /tampon sınırını aşıyor/);
  assert.equal(bucket.store.size, 0);
});

test('hangi yanıt tamponlanır: yalnız sunucu ve ağ hatası (401/404 geçerli rettir)', () => {
  for (const s of [0, 500, 502, 503, 504]) assert.equal(shouldSpool(s), true, String(s));
  for (const s of [200, 204, 400, 401, 403, 404, 429]) assert.equal(shouldSpool(s), false, String(s));
});

test('bozuk ya da eski biçimli kayıt ayrıştırılmaz (silinmez, bırakılır)', () => {
  assert.equal(parseRecord('{bozuk'), null);
  assert.equal(parseRecord('[]'), null);
  assert.equal(parseRecord(JSON.stringify({ surum: 2, yol: '/x', yontem: 'POST', govdeB64: '', alindi: 'x' })), null);
  assert.equal(parseRecord(JSON.stringify({ surum: 1, yol: 'api/x', yontem: 'POST', govdeB64: '', alindi: 'x' })), null);
});

test('tamponu boşaltma: kayıtlar GELİŞ SIRASINDA verilir, kabul edilen kayıt ve mührü silinir', async () => {
  const bucket = fakeBucket();
  for (const [i, metin] of ['birinci', 'ikinci', 'ucuncu'].entries()) {
    await spoolWebhook({ bucket, epoch: EPOCH, now: 1_700_000_000_000 + i * 1000 }, twilioIstek(`Body=${metin}`));
  }
  const verilen = [];
  const ozet = await drainSpool({
    bucket,
    epoch: EPOCH,
    teslim: async (kayit) => {
      verilen.push(new TextDecoder().decode(recordBody(kayit)));
      return { ok: true, status: 200 };
    },
  });
  assert.deepEqual(verilen, ['Body=birinci', 'Body=ikinci', 'Body=ucuncu']);
  assert.equal(ozet.bulundu, 3);
  assert.equal(ozet.gonderildi, 3);
  assert.equal(ozet.kalan, 0);
  assert.equal(ozet.durdu, false);
  assert.equal(bucket.store.size, 0, 'kayıtlar ve mühürleri silinmeli');
});

test('geçici hata (5xx): tur durur, kayıt kalır, sıra bozulmaz', async () => {
  const bucket = fakeBucket();
  for (const [i, metin] of ['bir', 'iki', 'uc'].entries()) {
    await spoolWebhook({ bucket, epoch: EPOCH, now: 1_700_000_000_000 + i * 1000 }, twilioIstek(`Body=${metin}`));
  }
  const verilen = [];
  const ozet = await drainSpool({
    bucket,
    epoch: EPOCH,
    teslim: async (kayit) => {
      const govde = new TextDecoder().decode(recordBody(kayit));
      verilen.push(govde);
      return govde === 'Body=iki' ? { ok: false, status: 503 } : { ok: true, status: 200 };
    },
  });
  assert.deepEqual(verilen, ['Body=bir', 'Body=iki'], 'hatalı kayıttan sonrası denenmemeli (sıra korunur)');
  assert.equal(ozet.gonderildi, 1);
  assert.equal(ozet.basarisiz, 1);
  assert.equal(ozet.durdu, true);
  assert.equal(ozet.kalan, 2);
  // 2 kayıt + 2 mühür R2'de kalır
  assert.equal(bucket.store.size, 4);
});

test('kalıcı ret (4xx) ve bozuk kayıt: bırakılır, bildirilir, kuyruk tıkanmaz', async () => {
  const bucket = fakeBucket();
  await spoolWebhook({ bucket, epoch: EPOCH, now: 1_700_000_000_000 }, twilioIstek('Body=red'));
  await spoolWebhook({ bucket, epoch: EPOCH, now: 1_700_000_002_000 }, twilioIstek('Body=iyi'));
  await bucket.put(recordKey(EPOCH, 1_700_000_001_000, 'f'.repeat(64)), '{bozuk');

  const bildirimler = [];
  const ozet = await drainSpool({
    bucket,
    epoch: EPOCH,
    teslim: async (kayit) =>
      new TextDecoder().decode(recordBody(kayit)) === 'Body=red' ? { ok: false, status: 404 } : { ok: true, status: 200 },
    bildir: (olay) => bildirimler.push(olay),
  });
  assert.equal(ozet.reddedildi, 1);
  assert.equal(ozet.bozuk, 1);
  assert.equal(ozet.gonderildi, 1, 'tek bir kalıcı ret sıradakini engellememeli');
  assert.deepEqual(bildirimler.sort(), ['bozuk', 'reddedildi']);
});

test('boşaltma turu batch sınırını aşmaz ve kalanı bildirir', async () => {
  const bucket = fakeBucket();
  for (let i = 0; i < 5; i++) {
    await spoolWebhook({ bucket, epoch: EPOCH, now: 1_700_000_000_000 + i * 1000 }, twilioIstek(`Body=${i}`));
  }
  const ozet = await drainSpool({ bucket, epoch: EPOCH, limit: 2, teslim: async () => ({ ok: true, status: 200 }) });
  assert.equal(ozet.bulundu, 2);
  assert.equal(ozet.gonderildi, 2);
  assert.equal(ozet.dahaVar, true);
});

test('geri verilen istek: yol, imza başlığı, istemci IP\'si ve paylaşılan sır taşınır', async () => {
  const bucket = fakeBucket();
  const sonuc = await spoolWebhook({ bucket, epoch: EPOCH, now: 1_700_000_000_000 }, twilioIstek());
  const kayit = parseRecord(await (await bucket.get(sonuc.anahtar)).text());
  const istek = replayRequest(kayit, { drainSecret: 'paylasilan-sir', baseUrl: 'https://yemekgelsin.net' });
  assert.equal(new URL(istek.url).pathname, YOL);
  assert.equal(istek.method, 'POST');
  assert.equal(istek.headers.get('x-twilio-signature'), 'ImZaYmFzSWd6YQ==');
  assert.equal(istek.headers.get('x-forwarded-for'), '203.0.113.7');
  assert.equal(istek.headers.get('x-forwarded-proto'), 'https');
  assert.equal(istek.headers.get('x-forwarded-host'), 'yemekgelsin.net');
  assert.equal(istek.headers.get(DRAIN_HEADER), 'paylasilan-sir');
  assert.equal(istek.headers.get(REPLAY_HEADER), '2023-11-14T22:13:20.000Z');
  assert.equal(await istek.text(), TWILIO_BODY);
  // Sır verilmezse başlık hiç yazılmaz (uç kapalı demektir)
  assert.equal(replayRequest(kayit, {}).headers.get(DRAIN_HEADER), null);
});

test('container alamadı: tampona yazılır ve sağlayıcıya 200 dönülür (yeniden denemesin)', async () => {
  const bucket = fakeBucket();
  const uyarilar = [];
  const res = await tamponaAlVeOnayla(
    { bucket, epoch: EPOCH, now: 1_700_000_000_000, uyar: (olay, ayrinti) => uyarilar.push([olay, ayrinti]) },
    twilioIstek(),
    'container_yok',
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, tamponlandi: true });
  assert.equal(bucket.store.size, 2);
  assert.equal(uyarilar[0][0], 'webhook_tamponlandi');
  // Uyarıda kişisel veri ve belirteç yok
  const ayrinti = JSON.stringify(uyarilar[0][1]);
  assert.equal(ayrinti.includes('gizlibelirtec'), false);
  assert.equal(ayrinti.includes('905321234567'), false);
});

test('tampona YAZILAMADIYSA 200 dönülmez (kaydı olmayan kayba onay verilmez)', async () => {
  const bozukBucket = {
    async head() {
      return null;
    },
    async put() {
      throw new Error('R2 ulaşılamıyor');
    },
  };
  const uyarilar = [];
  const res = await tamponaAlVeOnayla(
    { bucket: bozukBucket, epoch: EPOCH, uyar: (olay) => uyarilar.push(olay) },
    twilioIstek(),
    'container_yok',
  );
  assert.equal(res.status, 503);
  assert.deepEqual(uyarilar, ['webhook_tampon_yazilamadi']);
});

test('tur: container isteği patlarsa kayıt bırakılır ve uyarı verilir', async () => {
  const bucket = fakeBucket();
  await spoolWebhook({ bucket, epoch: EPOCH, now: 1_700_000_000_000 }, twilioIstek());
  const uyarilar = [];
  const ozet = await runDrain({
    bucket,
    epoch: EPOCH,
    uyar: (olay) => uyarilar.push(olay),
    gonder: async () => {
      throw new Error('container yok');
    },
  });
  assert.equal(ozet.basarisiz, 1);
  assert.equal(ozet.kalan, 1);
  assert.deepEqual(uyarilar, ['webhook_drain_hatasi']);
  assert.equal(bucket.store.size, 2, 'kayıt ve mührü yerinde kalmalı');
});

test('uyarı gövdesi: kaynak/olay/zaman; adres yoksa gönderilmez, hata akışı bozmaz', async () => {
  const govde = uyariGovdesi('webhook_tamponlandi', { yol: '/api/v1/webhooks/wa/••••' }, 1_700_000_000_000);
  assert.equal(govde.kaynak, 'worker');
  assert.equal(govde.olay, 'webhook_tamponlandi');
  assert.equal(govde.zaman, '2023-11-14T22:13:20.000Z');

  assert.equal(await uyariGonder('', 'webhook_drain_hatasi'), false);
  assert.equal(await uyariGonder(undefined, 'webhook_drain_hatasi'), false);
  // Uyarı kanalı patlasa da hata yukarıya sızmaz
  assert.equal(
    await uyariGonder('https://ornek.gecersiz/uyari', 'webhook_drain_hatasi', {}, {
      fetchImpl: async () => {
        throw new Error('ağ yok');
      },
    }),
    false,
  );
  let gonderilen = null;
  assert.equal(
    await uyariGonder('https://ornek.gecersiz/uyari', 'container_baslatilamadi', { durum: 503 }, {
      fetchImpl: async (url, init) => {
        gonderilen = { url, init };
        return new Response(null, { status: 204 });
      },
      now: 1_700_000_000_000,
    }),
    true,
  );
  assert.equal(gonderilen.init.method, 'POST');
  assert.deepEqual(JSON.parse(gonderilen.init.body), {
    kaynak: 'worker',
    olay: 'container_baslatilamadi',
    zaman: '2023-11-14T22:13:20.000Z',
    ayrinti: { durum: 503 },
  });
});

// --- Yedek gözcüsü (src/alert.ts; denetim 2026-10-05 bulgu B) ------------------------------------------
// Worker'ın 5 dakikalık turu artık yedek yaşını GÖREN uca (/api/v1/health/worker) de yoklama yapar. Aşağıdakiler o
// turun saf karar mantığıdır: gövdeyi okuma, soğuma ve uyarı gövdesi.

/** `/api/v1/health/worker` yanıtının ilgili alanları (apps/api/src/routes/health.ts sözleşmesi). */
const ucGovdesi = (over = {}) => ({
  ok: true,
  degraded: false,
  warnings: [],
  db: 'up',
  jobLagSec: 0,
  stuckJobs: 0,
  maxLagSec: 300,
  lastBackupAgeSec: 48,
  maxBackupAgeSec: 900,
  ...over,
});

test('yedek okuması: eşik kararının kaynağı ucun warnings dizisidir', () => {
  const taze = yedekDurumunuOku(ucGovdesi());
  assert.deepEqual(taze, { yasSn: 48, esikSn: 900, eskidi: false });

  const eski = yedekDurumunuOku(ucGovdesi({ degraded: true, warnings: ['backup_stale'], lastBackupAgeSec: 11_000 }));
  assert.deepEqual(eski, { yasSn: 11_000, esikSn: 900, eskidi: true });

  // Başka bir uyarı (disk/bellek) yedek uyarısı DEĞİLDİR
  const disk = yedekDurumunuOku(ucGovdesi({ degraded: true, warnings: ['disk_low'], lastBackupAgeSec: 11_000 }));
  assert.equal(disk.eskidi, false);

  // Uç 503 dönse de (kuyruk takılı) gövde okunur: iki arıza aynı anda olabilir
  const takili = yedekDurumunuOku(ucGovdesi({ ok: false, stuckJobs: 3, degraded: true, warnings: ['backup_stale'] }));
  assert.equal(takili.eskidi, true);
});

test('yedek okuması: warnings yoksa (eski API sürümü) yaş/eşik karşılaştırmasına düşer', () => {
  const govde = ucGovdesi({ lastBackupAgeSec: 11_000 });
  delete govde.warnings;
  delete govde.degraded;
  assert.equal(yedekDurumunuOku(govde).eskidi, true);

  const sinirda = ucGovdesi({ lastBackupAgeSec: 900 });
  delete sinirda.warnings;
  assert.equal(yedekDurumunuOku(sinirda).eskidi, false, 'eşiğin tam üstü uyarı değil');

  // Eşik 0 = kapalı: yaş ne olursa olsun uyarı yok
  const kapali = ucGovdesi({ lastBackupAgeSec: 99_999, maxBackupAgeSec: 0 });
  delete kapali.warnings;
  assert.equal(yedekDurumunuOku(kapali).eskidi, false);
});

test('yedek okuması: bilinmeyen/bozuk gövde uyarı ÜRETMEZ (yanlış alarm kanalı güvenilmez yapar)', () => {
  for (const govde of [null, undefined, '', 'yedek yazildi', 42, [], {}]) {
    const okuma = yedekDurumunuOku(govde);
    assert.equal(okuma.eskidi, false, `beklenmedik gövde uyarı üretti: ${JSON.stringify(govde)}`);
  }
  // Durum dosyası yok (ilk yedek turundan önce): yaş null, uyarı yok
  const taze = yedekDurumunuOku(ucGovdesi({ lastBackupAgeSec: null }));
  assert.deepEqual(taze, { yasSn: null, esikSn: 900, eskidi: false });
  // Metin olarak gelen sayı okunmaz (uydurulmaz)
  assert.equal(yedekDurumunuOku(ucGovdesi({ lastBackupAgeSec: '11000' })).yasSn, null);
});

test('yedek uyarısı soğuması: her 5 dakikada bir aynı uyarı gitmez', () => {
  const eskidi = { yasSn: 11_000, esikSn: 900, eskidi: true };
  const saglam = { yasSn: 48, esikSn: 900, eskidi: false };
  assert.equal(YEDEK_UYARI_SOGUMA_MS, 60 * 60_000, 'soğuma bir saat (cron 5 dk)');

  // Eşik aşılmadıysa hiç gönderilmez
  assert.equal(yedekUyarisiGerekir(saglam, null, 0), false);
  // İlk kez: hemen
  assert.equal(yedekUyarisiGerekir(eskidi, null, 0), true);
  // Cron'un sonraki üç turu (5/10/55 dk) sessiz
  for (const dk of [5, 10, 55]) {
    assert.equal(yedekUyarisiGerekir(eskidi, 0, dk * 60_000), false, `${dk}. dakikada tekrar uyarı gitti`);
  }
  // Soğuma dolunca yeniden (düzelmeyen arıza sessizleşmez)
  assert.equal(yedekUyarisiGerekir(eskidi, 0, YEDEK_UYARI_SOGUMA_MS), true);
  // Soğuma 0 = kapalı
  assert.equal(yedekUyarisiGerekir(eskidi, 0, 1, 0), true);
  // İleri tarihli damga dizgini süresiz kilitlemez
  assert.equal(yedekUyarisiGerekir(eskidi, 10_000, 0), true);
});

test('yedek uyarısının gövdesinde yedek yaşı vardır; bilinmeyen alan yazılmaz', () => {
  assert.deepEqual(yedekUyariAyrinti({ yasSn: 11_000, esikSn: 900, eskidi: true }), {
    kaynak: 'yedek_gozcusu',
    yasSn: 11_000,
    esikSn: 900,
  });
  assert.deepEqual(yedekUyariAyrinti({ yasSn: null, esikSn: null, eskidi: true }), { kaynak: 'yedek_gozcusu' });
});

test('yedek_eskidi uyarısı ayrı bir olay türüdür ve yaşı taşır', async () => {
  let gonderilen = null;
  const okuma = yedekDurumunuOku(ucGovdesi({ degraded: true, warnings: ['backup_stale'], lastBackupAgeSec: 11_000 }));
  assert.equal(
    await uyariGonder('https://ornek.gecersiz/uyari', 'yedek_eskidi', yedekUyariAyrinti(okuma), {
      fetchImpl: async (url, init) => {
        gonderilen = { url, init };
        return new Response(null, { status: 204 });
      },
      now: 1_700_000_000_000,
    }),
    true,
  );
  assert.deepEqual(JSON.parse(gonderilen.init.body), {
    kaynak: 'worker',
    olay: 'yedek_eskidi',
    zaman: '2023-11-14T22:13:20.000Z',
    ayrinti: { kaynak: 'yedek_gozcusu', yasSn: 11_000, esikSn: 900 },
  });
});
