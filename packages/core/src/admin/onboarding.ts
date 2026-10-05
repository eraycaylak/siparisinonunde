// Kurulum (onboarding) hunisi — admin işletme listesinin "Kurulum" sütunu ve "takılanlar" görünümü (05 §A.2.2).
// İçe aktarma: `@siparis/core/admin/onboarding`.
//
// Ayrı modül: `admin/contracts.ts` zaten 500 satır sınırının çok üstünde; huni sözleşmenin kendisine bağlı
// değil (liste alanı `onboardingStep: z.string()`), bu yüzden büyüme buraya alındı.

/**
 * Huni adımları — `tenant_onboarding.step` kolonundaki kodlar. Sıra ilerlemeyi gösterir;
 * `services/onboarding/index.ts` içindeki `stepCode()` bu listeden birini yazar. Satır hiç yoksa işletme kayıt
 * olmuş ama panele hiç girmemiştir: huni başı (`account_created`) sayılır.
 */
export const ADMIN_ONBOARDING_STEPS = [
  'account_created',
  'profile_done',
  'menu_done',
  'ops_done',
  'wa_connected',
  'wa_test_done',
  'web_live',
  'live',
] as const;
export type AdminOnboardingStep = (typeof ADMIN_ONBOARDING_STEPS)[number];

/**
 * Etiketler listeye göre TAM olmak zorundadır (`Record<AdminOnboardingStep, …>`): `stepCode()` yeni bir adım
 * yazmaya başladığında etiketi eklemek derleme hatasıyla hatırlatılır, yoksa panelde ham kod görünürdü.
 */
const STEP_LABELS: Record<AdminOnboardingStep, string> = {
  account_created: 'Hesap açıldı',
  profile_done: 'Künye tamam',
  menu_done: 'Menü tamam',
  ops_done: 'Saat/bölge tamam',
  wa_connected: 'WhatsApp bağlı',
  wa_test_done: 'Test siparişi tamam',
  web_live: 'Web canlı',
  live: 'Tam canlı',
};

/** Okuma kolonu `text`: gelen değer listede olmayabilir, bu yüzden arama anahtarı `string`. */
export const ADMIN_ONBOARDING_STEP_LABELS: Record<string, string> = STEP_LABELS;

/** Bilinmeyen kod (eski kayıt, elle yazılmış değer) olduğu gibi gösterilir — liste 500 vermez. */
export function adminOnboardingStepLabel(step: string): string {
  return ADMIN_ONBOARDING_STEP_LABELS[step] ?? step;
}

/** "Takılan adım [T]": canlı olmayan işletme aynı adımda bu süreden uzun kalırsa takıldı sayılır. */
export const ADMIN_ONBOARDING_STUCK_HOURS = 48;
