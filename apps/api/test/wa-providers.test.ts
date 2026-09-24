// Sağlayıcı gövdeleri (cloud / d360, fetch sahte), webhook ayrıştırıcı, imza, hata eşlemesi, NetGSM.

import { afterEach, describe, expect, it } from 'vitest';
import { createNetgsmProvider, SmsSendError } from '../src/sms/index';
import {
  classifyWaErrorCode,
  getWaProvider,
  interactiveBody,
  parseCloudWebhook,
  setHttpFetch,
  signMetaPayload,
  templateBody,
  textBody,
  verifyMetaSignature,
  WaSendError,
  type WaAccountRef,
} from '../src/wa/index';
import { buildEchoPayload, buildInboundPayload, buildStatusPayload } from '../src/services/messaging/dev-payload';

const acc: WaAccountRef = {
  id: 'a1',
  tenantId: 't1',
  branchId: 'b1',
  provider: 'cloud',
  displayPhone: '+905550000099',
  phoneNumberId: '1234567890',
  wabaId: 'w1',
  apiKey: 'SECRET-TOKEN',
};

interface Captured {
  url: string;
  init: RequestInit;
}

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Captured[] = [];
  setHttpFetch(async (url, init) => {
    calls.push({ url, init: init ?? {} });
    const r = responses.shift() ?? { status: 200, body: { messages: [{ id: 'wamid.X' }] } };
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return calls;
}

afterEach(() => setHttpFetch(null));

/** Söz reddedilmeli; hata nesnesini döner. */
async function fail<E>(p: Promise<unknown>): Promise<E> {
  try {
    await p;
  } catch (err) {
    return err as E;
  }
  throw new Error('Hata bekleniyordu');
}

describe('Cloud gövde üretici', () => {
  it('metin: telefona gönderim, rakamlar, önizleme kapalı', () => {
    expect(textBody({ phone: '+905321234567' }, 'Merhaba')).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '905321234567',
      type: 'text',
      text: { body: 'Merhaba', preview_url: false },
    });
  });

  it('telefon yoksa BSUID (recipient alanı)', () => {
    const b = textBody({ bsuid: 'TR.123' }, 'x');
    expect(b.recipient).toBe('TR.123');
    expect(b.to).toBeUndefined();
  });

  it('butonlar: en çok 3, başlık ≤ 20', () => {
    const b = interactiveBody(
      { phone: '+905321234567' },
      {
        kind: 'buttons',
        body: 'Seç',
        buttons: [
          { id: 'a', title: 'Çok uzun bir buton başlığı burada' },
          { id: 'b', title: 'B' },
          { id: 'c', title: 'C' },
          { id: 'd', title: 'D' },
        ],
      },
    ) as unknown as { interactive: { type: string; action: { buttons: { reply: { id: string; title: string } }[] } } };
    expect(b.interactive.type).toBe('button');
    expect(b.interactive.action.buttons).toHaveLength(3);
    expect(b.interactive.action.buttons[0]!.reply.title.length).toBeLessThanOrEqual(20);
  });

  it('cta_url, list, location_request, template', () => {
    const cta = interactiveBody({ phone: '+905321234567' }, { kind: 'cta_url', body: 'Menü', url: { label: 'Menüyü aç', href: 'https://x/s/a?l=1' } }) as unknown as {
      interactive: { type: string; action: { name: string; parameters: { display_text: string; url: string } } };
    };
    expect(cta.interactive).toMatchObject({ type: 'cta_url', action: { name: 'cta_url', parameters: { display_text: 'Menüyü aç', url: 'https://x/s/a?l=1' } } });

    const list = interactiveBody(
      { phone: '+905321234567' },
      { kind: 'list', body: 'Ne oldu?', list: { buttonTitle: 'Sorunu seç', sections: [{ rows: [{ id: 'r1', title: 'Geç geldi' }] }] } },
    ) as unknown as { interactive: { type: string; action: { button: string; sections: { rows: { id: string }[] }[] } } };
    expect(list.interactive.type).toBe('list');
    expect(list.interactive.action.sections[0]!.rows[0]!.id).toBe('r1');

    const loc = interactiveBody({ phone: '+905321234567' }, { kind: 'location_request', body: 'Konum?' }) as unknown as { interactive: { type: string; action: { name: string } } };
    expect(loc.interactive).toMatchObject({ type: 'location_request_message', action: { name: 'send_location' } });

    const tpl = templateBody({ phone: '+905321234567' }, 'siparis_onaylandi_v1', 'tr', ['Bozok', '30', '#1001'], [{ type: 'url', index: 0, param: 'tok' }]) as unknown as {
      template: { name: string; language: { code: string }; components: { type: string; parameters: { text?: string }[] }[] };
    };
    expect(tpl.template.name).toBe('siparis_onaylandi_v1');
    expect(tpl.template.language.code).toBe('tr');
    expect(tpl.template.components[0]!.parameters.map((p) => p.text)).toEqual(['Bozok', '30', '#1001']);
    expect(tpl.template.components[1]).toMatchObject({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'tok' }] });
  });
});

describe('cloud / d360 sağlayıcıları (fetch sahte)', () => {
  it('cloud: Graph v23.0 /{phone_number_id}/messages + Bearer', async () => {
    const calls = fakeFetch([{ status: 200, body: { messages: [{ id: 'wamid.C1' }] } }]);
    const res = await getWaProvider('cloud').sendText(acc, { phone: '+905321234567' }, 'Selam');
    expect(res.wamid).toBe('wamid.C1');
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v23.0/1234567890/messages');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer SECRET-TOKEN');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ to: '905321234567', type: 'text' });
  });

  it('d360: waba-v2.360dialog.io/messages + D360-API-KEY, gövde aynı', async () => {
    const calls = fakeFetch([{ status: 200, body: { messages: [{ id: 'wamid.D1' }] } }]);
    const res = await getWaProvider('d360').sendInteractive(
      { ...acc, provider: 'd360' },
      { phone: '+905321234567' },
      { kind: 'buttons', body: 'x', buttons: [{ id: 'menu', title: 'Menüyü aç' }] },
    );
    expect(res.wamid).toBe('wamid.D1');
    expect(calls[0]!.url).toBe('https://waba-v2.360dialog.io/messages');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['D360-API-KEY']).toBe('SECRET-TOKEN');
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ type: 'interactive', interactive: { type: 'button' } });
  });

  it('hata eşlemesi: 131047 pencere, 190 token, 5xx yeniden dene', async () => {
    fakeFetch([
      { status: 400, body: { error: { code: 131047, message: 'Re-engagement message' } } },
      { status: 401, body: { error: { code: 190, message: 'Invalid OAuth access token' } } },
      { status: 503, body: { error: { message: 'unavailable' } } },
    ]);
    const p = getWaProvider('cloud');
    const e1 = await fail<WaSendError>(p.sendText(acc, { phone: '+905321234567' }, 'x'));
    expect(e1).toBeInstanceOf(WaSendError);
    expect(e1.action).toBe('window_closed');
    expect(e1.retryable).toBe(false);
    const e2 = await fail<WaSendError>(p.sendText(acc, { phone: '+905321234567' }, 'x'));
    expect(e2.action).toBe('account_token');
    const e3 = await fail<WaSendError>(p.sendText(acc, { phone: '+905321234567' }, 'x'));
    expect(e3.action).toBe('retry');
    expect(e3.retryable).toBe(true);
  });

  it('ağ hatası → yeniden denenebilir', async () => {
    setHttpFetch(async () => {
      throw new TypeError('fetch failed');
    });
    const e = await fail<WaSendError>(getWaProvider('cloud').sendText(acc, { phone: '+905321234567' }, 'x'));
    expect(e.code).toBe('network');
    expect(e.retryable).toBe(true);
  });

  it('eksik yapılandırma kalıcı hatadır', async () => {
    const e = await fail<WaSendError>(getWaProvider('cloud').sendText({ ...acc, apiKey: null }, { phone: '+905321234567' }, 'x'));
    expect(e.code).toBe('config_missing');
    expect(e.retryable).toBe(false);
  });

  it('kod sınıflandırma tablosu', () => {
    expect(classifyWaErrorCode('131026')).toBe('undeliverable');
    expect(classifyWaErrorCode('131042')).toBe('account_payment');
    expect(classifyWaErrorCode('131056')).toBe('retry');
    expect(classifyWaErrorCode('130429')).toBe('retry');
    expect(classifyWaErrorCode('132001')).toBe('template_error');
    expect(classifyWaErrorCode('131050')).toBe('marketing_suppressed');
    expect(classifyWaErrorCode('100', 400)).toBe('fail');
  });
});

describe('webhook ayrıştırıcı', () => {
  const dev = { phoneNumberId: 'PN1', displayPhone: '+905550000099', wabaId: 'W' };

  it('metin (wa_id + BSUID + profil adı)', () => {
    const { payload, wamid } = buildInboundPayload(dev, { phone: '+905321234567', name: 'Ali', bsuid: 'TR.1' }, { type: 'text', text: 'merhaba' });
    const [ev] = parseCloudWebhook(payload);
    expect(ev).toMatchObject({
      type: 'message',
      phoneNumberId: 'PN1',
      wamid,
      from: { phone: '+905321234567', bsuid: 'TR.1', name: 'Ali' },
      message: { kind: 'text', text: 'merhaba' },
    });
  });

  it('wa_id olmadan (kullanıcı adı): yalnız BSUID', () => {
    const { payload } = buildInboundPayload(dev, { bsuid: 'TR.only', username: 'ali.k' }, { type: 'text', text: 'x' });
    const ev = parseCloudWebhook(payload)[0]!;
    expect(ev.type).toBe('message');
    if (ev.type !== 'message') return;
    expect(ev.from.phone).toBeUndefined();
    expect(ev.from.bsuid).toBe('TR.only');
    expect(ev.from.username).toBe('ali.k');
  });

  it('buton / liste yanıtı, konum, görsel, ses, desteklenmeyen, request_welcome', () => {
    const f = { phone: '+905321234567' };
    const kinds = [
      buildInboundPayload(dev, f, { type: 'button_reply', id: 'menu', title: 'Menüyü aç' }),
      buildInboundPayload(dev, f, { type: 'list_reply', id: 'r', title: 'Geç geldi' }),
      buildInboundPayload(dev, f, { type: 'location', lat: 39.8, lng: 34.8, name: 'Ev' }),
      buildInboundPayload(dev, f, { type: 'image', caption: 'foto' }),
      buildInboundPayload(dev, f, { type: 'audio' }),
      buildInboundPayload(dev, f, { type: 'unsupported' }),
      buildInboundPayload(dev, f, { type: 'request_welcome' }),
    ].map(({ payload }) => {
      const [ev] = parseCloudWebhook(payload);
      return ev!.type === 'message' ? ev!.message : null;
    });
    expect(kinds).toEqual([
      { kind: 'button_reply', id: 'menu', title: 'Menüyü aç' },
      { kind: 'list_reply', id: 'r', title: 'Geç geldi' },
      { kind: 'location', lat: 39.8, lng: 34.8, name: 'Ev', address: undefined },
      expect.objectContaining({ kind: 'image', caption: 'foto' }),
      expect.objectContaining({ kind: 'audio' }),
      { kind: 'unsupported', type: 'unsupported' },
      { kind: 'request_welcome' },
    ]);
  });

  it('durum (pricing, hata, alıcı BSUID) ve echo', () => {
    const st = parseCloudWebhook(buildStatusPayload(dev, { wamid: 'wamid.S', status: 'failed', recipientPhone: '+905321234567', recipientBsuid: 'TR.9', errorCode: 131047 }));
    expect(st[0]).toMatchObject({ type: 'status', wamid: 'wamid.S', status: 'failed', errorCode: '131047', recipient: { phone: '+905321234567', bsuid: 'TR.9' } });
    const del = parseCloudWebhook(buildStatusPayload(dev, { wamid: 'wamid.T', status: 'delivered' }));
    expect(del[0]).toMatchObject({ type: 'status', pricing: { category: 'service', billable: true, type: 'regular' } });
    const { payload } = buildEchoPayload(dev, { phone: '+905321234567' }, 'Telefondan yazdım');
    expect(parseCloudWebhook(payload)[0]).toMatchObject({ type: 'echo', to: { phone: '+905321234567' }, text: 'Telefondan yazdım' });
  });

  it('bozuk gövde hata fırlatmaz', () => {
    expect(parseCloudWebhook(null)).toEqual([]);
    expect(parseCloudWebhook({ entry: [{ changes: [{ value: { messages: [{ type: 'text' }] } }] }] })).toEqual([]);
  });
});

describe('imza', () => {
  it('X-Hub-Signature-256 doğrulaması (ham gövde)', () => {
    const raw = Buffer.from('{"a":"\\u00e7"}');
    const sig = signMetaPayload(raw, 'app-secret');
    expect(verifyMetaSignature(raw, sig, 'app-secret')).toBe(true);
    expect(verifyMetaSignature(raw, sig, 'baska')).toBe(false);
    expect(verifyMetaSignature(Buffer.from('{"a":"ç"}'), sig, 'app-secret')).toBe(false);
    expect(verifyMetaSignature(raw, undefined, 'app-secret')).toBe(false);
    expect(verifyMetaSignature(raw, 'sha256=zz', 'app-secret')).toBe(false);
  });
});

describe('NetGSM (teyit edilmeli)', () => {
  it('GET parametreleri ve başarılı yanıt', async () => {
    const calls: string[] = [];
    setHttpFetch(async (url) => {
      calls.push(url);
      return new Response('00 123456789', { status: 200 });
    });
    const p = createNetgsmProvider({ usercode: 'u', password: 'p', header: 'SIPARISNDE' });
    const res = await p.send('+905321234567', 'Kod: 123456');
    expect(res.id).toBe('123456789');
    const u = new URL(calls[0]!);
    expect(u.origin + u.pathname).toBe('https://api.netgsm.com.tr/sms/send/get');
    expect(u.searchParams.get('usercode')).toBe('u');
    expect(u.searchParams.get('gsmno')).toBe('905321234567');
    expect(u.searchParams.get('msgheader')).toBe('SIPARISNDE');
    expect(u.searchParams.get('message')).toBe('Kod: 123456');
  });

  it('hata kodları', async () => {
    setHttpFetch(async () => new Response('30', { status: 200 }));
    const p = createNetgsmProvider({ usercode: 'u', password: 'p', header: 'H' });
    const e = await fail<SmsSendError>(p.send('+905321234567', 'x'));
    expect(e).toBeInstanceOf(SmsSendError);
    expect(e.code).toBe('30');
    expect(e.retryable).toBe(false);
  });
});
