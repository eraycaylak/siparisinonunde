// Akış B doğrulama ekranı artık KALICI ADRESTE: /t/<token> (denetim 2026-10-04 madde 3.1 / H6).
// Ekranın kendisi `@/components/orders/verification-screen` içindedir ve yalnız takip sayfasından çizilir.
// Bu dosya, checkout'un içe aktarma yolu kırılmasın diye geçiş bileşenini (router.replace → /t/<token>)
// aynı adla yeniden dışa verir. Checkout `awaiting_customer` sonucunu doğrudan /t/<token>'a yönlendirirse
// bu kabuk gereksiz kalır ve silinebilir.
export { VerificationHandoff as VerificationScreen, type VerificationHandoffProps } from '@/components/orders/verification-handoff';
