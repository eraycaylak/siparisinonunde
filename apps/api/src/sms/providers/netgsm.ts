// NetGSM SMS sağlayıcısı (teyit edilmeli): HTTP GET
//   https://api.netgsm.com.tr/sms/send/get?usercode=&password=&gsmno=&message=&msgheader=&dil=TR
// Başarılı yanıt: "00 <görev kimliği>" (ya da "01"/"02" + kimlik); hata kodları 20, 30, 40, 50, 51, 70, 80, 85.
// Başlık (msgheader) platformun onaylı alfanümerik başlığıdır (≤ 11 karakter, ör. "SIPARISNDE" — teyit edilmeli).

import { fetchWithTimeout } from '../../wa/http';
import type { SmsProvider } from '../types';

export const NETGSM_SEND_URL = 'https://api.netgsm.com.tr/sms/send/get';

export class SmsSendError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'SmsSendError';
  }
}

const NETGSM_ERRORS: Record<string, string> = {
  '20': 'Mesaj metni hatalı ya da çok uzun',
  '30': 'Geçersiz kullanıcı adı/şifre ya da API erişim izni yok',
  '40': 'Mesaj başlığı (gönderici adı) sistemde tanımlı değil',
  '50': 'Abone hesabı ile İYS kontrollü gönderim yapılamıyor',
  '51': 'Aboneye ait İYS marka bilgisi yok',
  '70': 'Hatalı sorgu (eksik parametre)',
  '80': 'Gönderim sınırı aşıldı',
  '85': 'Mükerrer gönderim sınırı aşıldı',
};

export interface NetgsmOptions {
  usercode: string;
  password: string;
  header: string;
}

export function createNetgsmProvider(opts: NetgsmOptions): SmsProvider {
  return {
    name: 'netgsm',
    async send(to, body) {
      const params = new URLSearchParams({
        usercode: opts.usercode,
        password: opts.password,
        gsmno: to.replace(/\D/g, ''),
        message: body,
        msgheader: opts.header,
        dil: 'TR',
      });
      let res: Response;
      try {
        res = await fetchWithTimeout(`${NETGSM_SEND_URL}?${params.toString()}`, { method: 'GET' });
      } catch {
        throw new SmsSendError('network', 'SMS sağlayıcısına ulaşılamadı', true);
      }
      const text = (await res.text().catch(() => '')).trim();
      if (!res.ok) throw new SmsSendError(`http_${res.status}`, `SMS sağlayıcısı hata döndü (${res.status})`, res.status >= 500);
      const [code, id] = text.split(/\s+/);
      if (code === '00' || code === '01' || code === '02') return { id: id ?? text };
      const known = code ? NETGSM_ERRORS[code] : undefined;
      throw new SmsSendError(code || 'unknown', known ?? `Bilinmeyen SMS yanıtı: ${text.slice(0, 60)}`, code === '80');
    },
  };
}
