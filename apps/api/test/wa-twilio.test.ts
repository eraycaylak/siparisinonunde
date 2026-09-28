// Twilio sağlayıcısı (docs/16): gönderim gövdesi, içerik kaynağı katalogu ve önbelleği, webhook ayrıştırıcı,
// X-Twilio-Signature, hata eşlemesi ve admin kurulum yardımcıları. Veritabanı gerektirmez (fetch sahte).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/app';
import { API_WA_WEBHOOK_PATH, formToObject, twilioWebhookUrl } from '../src/routes/webhooks/wa';
import { registerNumber, setupStatus } from '../src/services/admin/wa-setup';
import {
  approvalToTemplateStatus,
  findSender,
  maskWebhookUrl,
  twilioContentPayload,
  type TwilioSender,
} from '../src/services/admin/wa-setup-twilio';
import { WA_TEMPLATE_CATALOG } from '../src/services/messaging/template-bodies';
import {
  classifyWaErrorCode,
  configureTwilio,
  foldHeaderFooter,
  getWaProvider,
  listPickerDefinition,
  mediaKindOf,
  parseTwilioWebhook,
  planInteractive,
  quickReplyDefinition,
  resetTwilioContentCache,
  setHttpFetch,
  setTwilioContentStore,
  signTwilioRequest,
  twilioCodeToMeta,
  twilioMessageForm,
  twilioStatus,
  verifyTwilioSignature,
  WaSendError,
  type WaAccountRef,
  type WaInteractiveMessage,
} from '../src/wa/index';

// Sahte Account SID: gerçek anahtara benzeyen 34 karakterlik dizge dosyada DÜZ yazılmaz (GitHub gizli tarayıcısı
// test sabitlerini de gerçek anahtar sanıp push'u engelliyor); parçadan üretilir.
const HEX16 = '0123456789abcdef';
const ACCOUNT_SID = `AC${HEX16}${HEX16}`;
const AUTH_TOKEN = 'twilio-auth-token-gizli';

const acc: WaAccountRef = {
  id: 'a1',
  tenantId: 't1',
  branchId: 'b1',
  provider: 'twilio',
  displayPhone: '+18509099295',
  phoneNumberId: ACCOUNT_SID,
  wabaId: null,
  apiKey: AUTH_TOKEN,
};

const to = { phone: '+905321234567' };

interface Captured {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
}

function fakeFetch(responses: Array<{ status?: number; body: unknown }>): Captured[] {
  const calls: Captured[] = [];
  setHttpFetch(async (url, init) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : '', headers });
    const r = responses.shift() ?? { body: { sid: 'SM_default' } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

/** Gönderilen form gövdesini nesneye çevirir. */
const form = (c: Captured) => Object.fromEntries(new URLSearchParams(c.body));

beforeEach(() => {
  setTwilioContentStore(null);
  resetTwilioContentCache();
  configureTwilio({ statusCallbackUrl: null });
});

afterEach(() => {
  setHttpFetch(null);
  setTwilioContentStore(null);
  resetTwilioContentCache();
  configureTwilio({ statusCallbackUrl: null });
});

async function fail<E>(p: Promise<unknown>): Promise<E> {
  try {
    await p;
  } catch (err) {
    return err as E;
  }
  throw new Error('Hata bekleniyordu');
}

// ---------------------------------------------------------------------------

describe('Twilio gönderim gövdesi (16 §2.1)', () => {
  it('düz metin: whatsapp: önekli From/To ve Body; durum adresi verilmişse eklenir', () => {
    const f = twilioMessageForm(acc, to, { body: 'Merhaba' });
    expect(f).toEqual({ From: 'whatsapp:+18509099295', To: 'whatsapp:+905321234567', Body: 'Merhaba' });
    configureTwilio({ statusCallbackUrl: 'https://yemekgelsin.net/api/v1/webhooks/wa/shared/abc' });
    expect(twilioMessageForm(acc, to, { body: 'x' }).StatusCallback).toBe('https://yemekgelsin.net/api/v1/webhooks/wa/shared/abc');
  });

  it('içerik kaynağı verilince Body gitmez, ContentVariables JSON olur', () => {
    const f = twilioMessageForm(acc, to, { contentSid: 'HX1', contentVariables: { '1': 'gövde' } });
    expect(f.Body).toBeUndefined();
    expect(f.ContentSid).toBe('HX1');
    expect(JSON.parse(f.ContentVariables!)).toEqual({ '1': 'gövde' });
  });

  it('BSUID ile gönderilemez: Twilio yalnız telefonla çalışır (16 §2.2)', () => {
    expect(() => twilioMessageForm(acc, { bsuid: 'bs-1' }, { body: 'x' })).toThrow(WaSendError);
  });

  it('eksik yapılandırma kalıcı hatadır (yeniden denenmez)', async () => {
    const p = getWaProvider('twilio');
    const noSid = await fail<WaSendError>(p.sendText({ ...acc, phoneNumberId: null }, to, 'x'));
    expect(noSid.code).toBe('config_missing');
    expect(noSid.retryable).toBe(false);
    const noKey = await fail<WaSendError>(p.sendText({ ...acc, apiKey: null }, to, 'x'));
    expect(noKey.code).toBe('config_missing');
  });
});

describe('Twilio etkileşimli mesaj → içerik kaynağı (16 §2.3)', () => {
  it('başlık ve alt bilgi gövdeye katlanır (Twilio bu alanları taşımaz)', () => {
    expect(foldHeaderFooter({ body: 'Gövde', header: 'Bozok Pide', footer: 'Yemek Gelsin' })).toBe('*Bozok Pide*\nGövde\nYemek Gelsin');
    expect(foldHeaderFooter({ body: 'Gövde' })).toBe('Gövde');
  });

  it('butonlar: buton sayısına göre kaynak, değişkenler başlık + kimlik sırasıyla', () => {
    const msg: WaInteractiveMessage = {
      kind: 'buttons',
      body: 'Onaylıyor musunuz?',
      header: 'Bozok Pide',
      buttons: [
        { id: 'order:1', title: 'Evet' },
        { id: 'cancel:1', title: 'Hayır' },
      ],
    };
    const plan = planInteractive(msg)!;
    expect(plan.definition.friendlyName).toBe('yg_qr2');
    expect(plan.definition.types['twilio/quick-reply']).toEqual({
      body: '{{1}}',
      actions: [
        { type: 'QUICK_REPLY', title: '{{2}}', id: '{{3}}' },
        { type: 'QUICK_REPLY', title: '{{4}}', id: '{{5}}' },
      ],
    });
    expect(plan.variables).toEqual({ '1': '*Bozok Pide*\nOnaylıyor musunuz?', '2': 'Evet', '3': 'order:1', '4': 'Hayır', '5': 'cancel:1' });
  });

  it('liste: bölümler düzleştirilir, bölüm başlığı açıklamaya geçer, 10 satırla sınırlı', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `shop:${i}`, title: `Dükkan ${i}` }));
    const plan = planInteractive({ kind: 'list', body: 'Seçin', list: { buttonTitle: 'Dükkanlar', sections: [{ title: 'Yakındakiler', rows }] } })!;
    expect(plan.definition.friendlyName).toBe('yg_listd10');
    const items = (plan.definition.types['twilio/list-picker'] as { items: unknown[] }).items;
    expect(items).toHaveLength(10);
    expect(plan.variables['1']).toBe('Seçin');
    expect(plan.variables['2']).toBe('Dükkanlar');
    expect(plan.variables['3']).toBe('Dükkan 0');
    expect(plan.variables['4']).toBe('shop:0');
    expect(plan.variables['5']).toBe('Yakındakiler');
  });

  it('açıklamasız liste ayrı ailedir (boş değişken bırakılmaz)', () => {
    const plan = planInteractive({ kind: 'list', body: 'Seçin', list: { buttonTitle: 'Seç', sections: [{ rows: [{ id: 'a', title: 'A' }] }] } })!;
    expect(plan.definition.friendlyName).toBe('yg_list1');
    expect(Object.keys(plan.variables).sort()).toEqual(['1', '2', '3', '4']);
  });

  it('cta_url ve konum isteği düz metne indirgenir (plan yok)', () => {
    const cta: WaInteractiveMessage = { kind: 'cta_url', body: 'Takip', url: { label: 'Siparişi takip et', href: 'https://yemekgelsin.net/t/abc' } };
    expect(planInteractive(cta)).toBeNull();
    const loc: WaInteractiveMessage = { kind: 'location_request', body: 'Konumunuzu paylaşır mısınız?' };
    expect(planInteractive(loc)).toBeNull();
  });

  it('katalog tanımları değişken numaralarını doğru üretir', () => {
    expect(quickReplyDefinition(1).friendlyName).toBe('yg_qr1');
    expect(listPickerDefinition(3, false).types['twilio/list-picker']).toEqual({
      body: '{{1}}',
      button: '{{2}}',
      items: [
        { item: '{{3}}', id: '{{4}}' },
        { item: '{{5}}', id: '{{6}}' },
        { item: '{{7}}', id: '{{8}}' },
      ],
    });
  });
});

describe('Twilio sağlayıcı çağrıları', () => {
  it('metin: tek POST, Basic yetkilendirme, sid wamid olur', async () => {
    const calls = fakeFetch([{ body: { sid: 'SM123' } }]);
    const r = await getWaProvider('twilio').sendText(acc, to, 'Merhaba');
    expect(r.wamid).toBe('SM123');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`);
    expect(calls[0]!.headers.Authorization).toBe(`Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')}`);
    expect(form(calls[0]!)).toMatchObject({ From: 'whatsapp:+18509099295', To: 'whatsapp:+905321234567', Body: 'Merhaba' });
  });

  it('etkileşimli: içerik kaynağı bir kez üretilir, ikinci mesajda yeniden üretilmez', async () => {
    const msg: WaInteractiveMessage = { kind: 'buttons', body: 'Onay?', buttons: [{ id: 'yes', title: 'Evet' }] };
    const calls = fakeFetch([
      { body: { contents: [], meta: {} } }, // içerik listesi: yok
      { body: { sid: 'HXabc' } }, // oluşturuldu
      { body: { sid: 'SM1' } }, // mesaj
      { body: { sid: 'SM2' } }, // ikinci mesaj
    ]);
    const first = await getWaProvider('twilio').sendInteractive(acc, to, msg);
    expect(first.wamid).toBe('SM1');
    expect(calls.map((c) => `${c.method} ${c.url.split('?')[0]}`)).toEqual([
      'GET https://content.twilio.com/v1/Content',
      'POST https://content.twilio.com/v1/Content',
      `POST https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
    ]);
    expect(form(calls[2]!).ContentSid).toBe('HXabc');

    const second = await getWaProvider('twilio').sendInteractive(acc, to, msg);
    expect(second.wamid).toBe('SM2');
    expect(calls).toHaveLength(4); // yalnız mesaj çağrısı eklendi
  });

  it('Twilio’da zaten duran kaynak sahiplenilir (yeniden üretilmez)', async () => {
    const calls = fakeFetch([
      { body: { contents: [{ sid: 'HXvar', friendly_name: 'yg_qr1' }], meta: {} } },
      { body: { sid: 'SM9' } },
    ]);
    await getWaProvider('twilio').sendInteractive(acc, to, { kind: 'buttons', body: 'x', buttons: [{ id: 'a', title: 'A' }] });
    expect(calls).toHaveLength(2);
    expect(form(calls[1]!).ContentSid).toBe('HXvar');
  });

  it('cta_url düz metne düşer: içerik kaynağı çağrısı yapılmaz, bağlantı gövdede', async () => {
    const calls = fakeFetch([{ body: { sid: 'SM5' } }]);
    await getWaProvider('twilio').sendInteractive(acc, to, {
      kind: 'cta_url',
      body: 'Siparişinizi takip edebilirsiniz.',
      url: { label: 'Takip et', href: 'https://yemekgelsin.net/t/abc' },
    });
    expect(calls).toHaveLength(1);
    expect(form(calls[0]!).Body).toContain('https://yemekgelsin.net/t/abc');
  });

  it('şablon: kaynak yoksa kalıcı şablon hatası, mesaj gönderilmez', async () => {
    const calls = fakeFetch([{ body: { contents: [], meta: {} } }]);
    const err = await fail<WaSendError>(getWaProvider('twilio').sendTemplate(acc, to, 'siparis_alindi_v1', 'tr', ['Ayşe']));
    expect(err.code).toBe('132000');
    expect(err.action).toBe('template_error');
    expect(calls.every((c) => !c.url.includes('Messages.json'))).toBe(true);
  });

  it('şablon: kaynak varsa ContentVariables gövde parametreleri + URL butonu parametresiyle gider', async () => {
    const calls = fakeFetch([
      { body: { contents: [{ sid: 'HXtpl', friendly_name: 'siparis_teslim_v1' }], meta: {} } },
      { body: { sid: 'SM7' } },
    ]);
    await getWaProvider('twilio').sendTemplate(acc, to, 'siparis_teslim_v1', 'tr', ['Bozok Pide', '#1042'], [{ type: 'url', index: 0, param: 'tok-1' }]);
    const f = form(calls[1]!);
    expect(f.ContentSid).toBe('HXtpl');
    expect(JSON.parse(f.ContentVariables!)).toEqual({ '1': 'Bozok Pide', '2': '#1042', '3': 'tok-1' });
  });

  it('hata kodları Meta karşılığına çevrilir: 63016 → pencere kapalı, 20003 → token', async () => {
    fakeFetch([{ status: 400, body: { code: 63016, message: 'outside session', status: 400 } }]);
    const closed = await fail<WaSendError>(getWaProvider('twilio').sendText(acc, to, 'x'));
    expect(closed.code).toBe('131047');
    expect(closed.action).toBe('window_closed');

    fakeFetch([{ status: 401, body: { code: 20003, message: 'auth', status: 401 } }]);
    const auth = await fail<WaSendError>(getWaProvider('twilio').sendText(acc, to, 'x'));
    expect(auth.action).toBe('account_token');

    fakeFetch([{ status: 429, body: { code: 20429, message: 'too many', status: 429 } }]);
    const rate = await fail<WaSendError>(getWaProvider('twilio').sendText(acc, to, 'x'));
    expect(rate.action).toBe('retry');
  });

  it('kod eşlemesi tablosu (16 §2.6)', () => {
    expect(twilioCodeToMeta('63016', 400)).toBe('131047');
    expect(twilioCodeToMeta('63003', 400)).toBe('131026');
    expect(twilioCodeToMeta('63021', 400)).toBe('132000');
    expect(classifyWaErrorCode(twilioCodeToMeta('63021', 400))).toBe('template_error');
    expect(twilioCodeToMeta('99999', 400)).toBe('99999');
  });
});

describe('Twilio webhook ayrıştırıcı (16 §2.5)', () => {
  const base = { MessageSid: 'SM1', AccountSid: ACCOUNT_SID, From: 'whatsapp:+905321234567', To: 'whatsapp:+18509099295' };

  it('metin mesajı: gönderen telefonu E.164, profil adı, hesap kimliği', () => {
    const [ev] = parseTwilioWebhook({ ...base, Body: '#BOZOK', ProfileName: 'Ayşe', WaId: '905321234567' });
    expect(ev).toMatchObject({ type: 'message', wamid: 'SM1', phoneNumberId: ACCOUNT_SID });
    expect(ev!.type === 'message' && ev!.from).toEqual({ phone: '+905321234567', name: 'Ayşe' });
    expect(ev!.type === 'message' && ev!.message).toEqual({ kind: 'text', text: '#BOZOK' });
  });

  it('buton ve liste yanıtı kimlikleriyle gelir', () => {
    const [btn] = parseTwilioWebhook({ ...base, Body: 'Evet', ButtonText: 'Evet', ButtonPayload: 'order:42' });
    expect(btn!.type === 'message' && btn!.message).toEqual({ kind: 'button_reply', id: 'order:42', title: 'Evet' });
    const [list] = parseTwilioWebhook({ ...base, ListId: 'shop:7', ListTitle: 'Bozok Pide' });
    expect(list!.type === 'message' && list!.message).toEqual({ kind: 'list_reply', id: 'shop:7', title: 'Bozok Pide' });
  });

  it('konum, medya ve alıntılanan mesaj', () => {
    const [loc] = parseTwilioWebhook({ ...base, Latitude: '39.82', Longitude: '34.80', Label: 'Ev', Address: 'Merkez' });
    expect(loc!.type === 'message' && loc!.message).toEqual({ kind: 'location', lat: 39.82, lng: 34.8, name: 'Ev', address: 'Merkez' });
    const [img] = parseTwilioWebhook({ ...base, NumMedia: '1', MediaContentType0: 'image/jpeg', MediaUrl0: 'https://api.twilio.com/m/1', Body: 'fiş' });
    expect(img!.type === 'message' && img!.message).toEqual({ kind: 'image', mediaId: 'https://api.twilio.com/m/1', caption: 'fiş' });
    const [rep] = parseTwilioWebhook({ ...base, Body: 'evet', OriginalRepliedMessageSid: 'SM0' });
    expect(rep!.type === 'message' && rep!.contextWamid).toBe('SM0');
    expect(mediaKindOf('image/webp')).toBe('sticker');
    expect(mediaKindOf('application/pdf')).toBe('document');
  });

  it('durum bildirimi: yalnız anlamlı durumlar olay üretir', () => {
    const [ev] = parseTwilioWebhook({ ...base, MessageStatus: 'delivered' });
    expect(ev).toMatchObject({ type: 'status', status: 'delivered', wamid: 'SM1' });
    expect(ev!.type === 'status' && ev!.recipient).toEqual({ phone: '+18509099295' });
    expect(parseTwilioWebhook({ ...base, MessageStatus: 'queued' })).toEqual([]);
    expect(parseTwilioWebhook({ ...base, MessageStatus: 'undelivered', ErrorCode: '63016' })[0]).toMatchObject({ status: 'failed', errorCode: '63016' });
    expect(twilioStatus('read')).toBe('read');
    expect(twilioStatus('sending')).toBeNull();
  });

  it('tanınmayan yük boş dizi döner (hata fırlatmaz)', () => {
    expect(parseTwilioWebhook(null)).toEqual([]);
    expect(parseTwilioWebhook({})).toEqual([]);
    expect(parseTwilioWebhook({ AccountSid: ACCOUNT_SID })).toEqual([]);
  });
});

describe('X-Twilio-Signature (16 §2.5)', () => {
  const url = 'https://yemekgelsin.net/api/v1/webhooks/wa/shared/gizli-belirtec';
  const params = { MessageSid: 'SM1', From: 'whatsapp:+905321234567', Body: 'merhaba' };

  it('imza URL + alfabetik sıralı alanlarla üretilir ve doğrulanır', () => {
    const sig = signTwilioRequest(url, params, AUTH_TOKEN);
    expect(verifyTwilioSignature(url, params, sig, AUTH_TOKEN)).toBe(true);
    // Alan sırası imzayı değiştirmez
    const reordered = { Body: 'merhaba', From: 'whatsapp:+905321234567', MessageSid: 'SM1' };
    expect(signTwilioRequest(url, reordered, AUTH_TOKEN)).toBe(sig);
  });

  it('değiştirilen alan, adres ya da anahtar doğrulamayı düşürür', () => {
    const sig = signTwilioRequest(url, params, AUTH_TOKEN);
    expect(verifyTwilioSignature(url, { ...params, Body: 'baska' }, sig, AUTH_TOKEN)).toBe(false);
    expect(verifyTwilioSignature(`${url}x`, params, sig, AUTH_TOKEN)).toBe(false);
    expect(verifyTwilioSignature(url, params, sig, 'baska-token')).toBe(false);
    expect(verifyTwilioSignature(url, params, undefined, AUTH_TOKEN)).toBe(false);
    expect(verifyTwilioSignature(url, params, sig, '')).toBe(false);
  });

  it('webhook yolu app.ts önekiyle aynıdır (imza adresi buradan kurulur)', () => {
    expect(API_WA_WEBHOOK_PATH).toBe(`${API_PREFIX}/webhooks/wa`);
    expect(twilioWebhookUrl('https://yemekgelsin.net/', '/api/v1/webhooks/wa/shared/t')).toBe('https://yemekgelsin.net/api/v1/webhooks/wa/shared/t');
  });

  it('form gövdesi düz nesneye çevrilir', () => {
    expect(formToObject(Buffer.from('MessageSid=SM1&Body=merhaba+d%C3%BCnya'))).toEqual({ MessageSid: 'SM1', Body: 'merhaba dünya' });
  });
});

describe('Twilio kurulum durumu (16 §4)', () => {
  const base = {
    APP_BASE_URL: 'https://yemekgelsin.net',
    NODE_ENV: 'production' as const,
    DEPLOY_ENV: 'production' as const,
    PLATFORM_WA_PROVIDER: 'twilio' as const,
    PLATFORM_WA_API_KEY: AUTH_TOKEN,
    PLATFORM_WA_PHONE_NUMBER_ID: ACCOUNT_SID,
    PLATFORM_WA_WABA_ID: undefined,
    PLATFORM_WA_DISPLAY_PHONE: '+18509099295',
    PLATFORM_WA_WEBHOOK_TOKEN: 'a'.repeat(32),
    WA_APP_SECRET: undefined,
    WA_VERIFY_TOKEN: 'b'.repeat(32),
  };

  it('bilgiler tamsa sorun yok; test / webhook / şablon adımları açık, Meta adımları kapalı', () => {
    const s = setupStatus(base);
    expect(s.provider).toBe('twilio');
    expect(s.providerLabel).toBe('Twilio');
    expect(s.problems).toEqual([]);
    expect(s.apiBase).toBe('api.twilio.com/2010-04-01');
    expect(s.actions).toEqual({ test: true, register: false, subscribe: false, templates: true, webhook: true });
    expect(s.webhookUrlMasked).toBe('https://yemekgelsin.net/api/v1/webhooks/wa/shared/••••aaaa');
    // Gizli değerler yalnız son 4 karakter
    expect(s.fields.apiKey.tail).toBe(`••••${AUTH_TOKEN.slice(-4)}`);
    expect(JSON.stringify(s)).not.toContain(AUTH_TOKEN);
  });

  it('eksik Account SID / Auth Token ve biçimsiz SID sorun satırı üretir, adımları kapatır', () => {
    const noSid = setupStatus({ ...base, PLATFORM_WA_PHONE_NUMBER_ID: undefined });
    expect(noSid.problems.join(' ')).toMatch(/Account SID tanımlı değil/);
    expect(noSid.actions.test).toBe(false);
    const badSid = setupStatus({ ...base, PLATFORM_WA_PHONE_NUMBER_ID: '18509099295' });
    expect(badSid.problems.join(' ')).toMatch(/"AC" ile başlayan 34 karakter/);
    const noToken = setupStatus({ ...base, PLATFORM_WA_API_KEY: undefined });
    expect(noToken.problems.join(' ')).toMatch(/Auth Token tanımlı değil/);
    expect(noToken.actions.webhook).toBe(false);
  });

  it('webhook belirteci yoksa "Twilio’ya kaydedilecek adres oluşmaz" der', () => {
    const s = setupStatus({ ...base, PLATFORM_WA_WEBHOOK_TOKEN: undefined });
    expect(s.problems.join(' ')).toMatch(/Twilio['’]ya kaydedilecek webhook adresi oluşmaz/);
    expect(s.actions.webhook).toBe(false);
  });

  it('Meta’ya özel adımlar (numarayı etkinleştir / abonelik) Twilio’da 409 döner', async () => {
    const err = await fail<{ code: string; message: string }>(registerNumber(base, '123456'));
    expect(err.code).toBe('wa_setup_not_cloud');
    expect(err.message).toMatch(/Twilio['’]da gerekmez/);
  });
});

describe('Twilio admin kurulumu (16 §4)', () => {
  it('gönderen numaraya göre bulunur', () => {
    const senders: TwilioSender[] = [
      { sid: 'XE1', sender_id: 'whatsapp:+14155551234' },
      { sid: 'XE2', sender_id: 'whatsapp:+18509099295' },
    ];
    expect(findSender(senders, '+1 850 909 9295')?.sid).toBe('XE2');
    expect(findSender(senders, '+905321234567')).toBeNull();
    expect(findSender([], '+18509099295')).toBeNull();
  });

  it('webhook adresi maskelenir: ortak adresimizde yalnız son 4 karakter', () => {
    const c = { APP_BASE_URL: 'https://yemekgelsin.net' } as never;
    expect(maskWebhookUrl('https://yemekgelsin.net/api/v1/webhooks/wa/shared/abcdef123456', c)).toBe('https://yemekgelsin.net/api/v1/webhooks/wa/shared/••••3456');
    expect(maskWebhookUrl('https://baska.example/hook/uzun-gizli-parca?x=1', c)).toBe('https://baska.example/hook/••••arca?…');
    expect(maskWebhookUrl('bozuk', c)).toBe('(okunamayan adres)');
  });

  it('onay durumu şablon durum sözlüğüne çevrilir', () => {
    expect(approvalToTemplateStatus('approved')).toBe('APPROVED');
    expect(approvalToTemplateStatus('pending')).toBe('PENDING');
    expect(approvalToTemplateStatus('rejected')).toBe('REJECTED');
    expect(approvalToTemplateStatus('unsubmitted')).toBe('SUBMITTED');
    expect(approvalToTemplateStatus(null)).toBeNull();
  });

  it('şablon → içerik gövdesi: butonsuz metin, URL butonu call-to-action, değişken numaraları gövdeden sonra', () => {
    const base = 'https://yemekgelsin.net';
    for (const def of WA_TEMPLATE_CATALOG) {
      const payload = twilioContentPayload(def, base) as { friendly_name: string; language: string; types: Record<string, unknown>; variables: Record<string, string> };
      expect(payload.friendly_name).toBe(def.name);
      expect(payload.language).toBe('tr');
      expect(Object.keys(payload.types)).toHaveLength(1);
      // Gövde değişkenlerinin hepsi örnekleriyle tanımlı
      for (let i = 1; i <= def.params.length; i++) expect(payload.variables[String(i)]).toBeDefined();
      const type = Object.keys(payload.types)[0]!;
      const urlButtons = def.buttons.filter((b) => b.type === 'url');
      if (urlButtons.length) {
        expect(type).toBe('twilio/call-to-action');
        const actions = (payload.types[type] as { actions: { url: string }[] }).actions;
        for (const a of actions) expect(a.url.startsWith(base)).toBe(true);
        const dynamic = urlButtons.filter((b) => b.type === 'url' && b.dynamic);
        if (dynamic.length) {
          // Dinamik URL değişkeni gövde değişkenlerinden SONRA numaralanır
          expect(actions.some((a) => a.url.includes(`{{${def.params.length + 1}}}`))).toBe(true);
          expect(payload.variables[String(def.params.length + 1)]).toBeDefined();
        }
      } else if (def.buttons.length) {
        expect(type).toBe('twilio/quick-reply');
      } else {
        expect(type).toBe('twilio/text');
      }
    }
  });
});
