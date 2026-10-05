// E-posta sağlayıcı arayüzü: mock | resend (docs/18 §3). SMS katmanıyla (`apps/api/src/sms/`) aynı şekle sahiptir:
// tek bir `send` sözleşmesi, sağlayıcı seçimi ortam değişkeninden (`EMAIL_PROVIDER`).

/**
 * E-postanın hangi akış için gönderildiği. Teşhis (log, `notifications.payload.purpose`) ve docs/18 §3'teki
 * "hangi akışlar e-postaya bağlı" tablosunun kod tarafındaki karşılığıdır.
 *
 * Akışların kendisi HENÜZ BAĞLANMADI (bu tur yalnız kanal iskeleti). Akışlar bağlandığında bu liste
 * `packages/core/src/enums.ts`'e (`SMS_PURPOSES` gibi) taşınır; şimdilik burada durur ki `packages/core`
 * kullanılmayan bir enum taşımasın.
 */
export const EMAIL_PURPOSES = [
  /** Pazarlama sitesindeki demo/lead formu bize haber verir (08 §2.8 satır 15). */
  'lead_notice',
  /** KVKK m.11 başvurusunun alındığı ve 30 günlük süre (08 §2.10). */
  'kvkk_request',
  /** Panel kullanıcısının parola sıfırlama bağlantısı. */
  'password_reset',
  /** Abonelik faturası / ödeme bildirimi (08 §6). */
  'invoice',
  /** Kurulum doğrulaması: kanalın çalıştığını görmek için elle gönderilen tek mesaj (docs/18 §3 "Nasıl doğrulanır"). */
  'ops_test',
] as const;
export type EmailPurpose = (typeof EMAIL_PURPOSES)[number];

/** Tek alıcılı e-posta. Toplu gönderim (çok alıcı) bilerek yoktur: alıcılar birbirinin adresini görmemeli. */
export interface EmailMessage {
  /** Tek alıcı adresi. */
  to: string;
  subject: string;
  /** Düz metin gövde ZORUNLUDUR (yalnız HTML gönderen e-posta spam'e düşer ve okuyucu erişilebilirliğini kırar). */
  text: string;
  /** İsteğe bağlı HTML gövde; verilirse `text` ile aynı bilgiyi taşır. */
  html?: string | undefined;
  /** Yanıtların gideceği adres; boşsa `EMAIL_REPLY_TO`, o da boşsa gönderici adresi. */
  replyTo?: string | undefined;
}

export interface EmailProvider {
  readonly name: 'mock' | 'resend';
  /** Dönen id sağlayıcı mesaj kimliğidir (teslim takibi ve destek yazışması için). */
  send(message: EmailMessage): Promise<{ id: string }>;
}

/** SMS tarafındaki `SmsSendError` ile aynı sözleşme: `retryable` kuyruk yeniden denemesini belirler. */
export class EmailSendError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}

/**
 * Kabaca RFC 5322'nin kullanılan alt kümesi: tek `@`, etki alanında en az bir nokta, boşluk yok.
 * Sınırda doğrulama (CLAUDE.md "Validate input at system boundaries") içindir, adres doğruluğunu kanıtlamaz.
 */
const EMAIL_RE = /^[^\s<>@,"]+@[^\s<>@,".]+\.[^\s<>@,"]{2,}$/;

export function isEmailAddress(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

/**
 * Günlüğe yazılabilir maskeli adres: `er***@gmail.com`. Telefon maskelemesiyle (CLAUDE.md değişmez kural 7) aynı
 * gerekçe — e-posta adresi kişisel veridir, log ve uyarı kanalına açık yazılmaz. Yerel kısmın ilk iki karakteri
 * destek yazışmasında "doğru adres mi" sorusunu cevaplamaya yeter.
 */
export function maskEmail(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  const at = v.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  const head = local.slice(0, 2);
  // Sabit genişlik: yıldız sayısı yerel bölümün uzunluğunu sızdırmasın (maskPhone ile aynı üslup)
  return `${head}***@${domain}`;
}
