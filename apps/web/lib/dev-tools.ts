/** Geliştirici araçları (/dev/whatsapp) açık mı? Üretimde 0 (14 §3). */
export function devToolsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEV_TOOLS === '1' || process.env.DEV_TOOLS === '1';
}
