-- Ortak numara (00 §12a madde 8; 14 §8.1): dükkan kodu en az bir harf içerir. Yalnız rakamdan oluşan kod ("1453")
-- bot mesajlarındaki sipariş numarasıyla ("Sipariş no: #1047") karışır: başka dükkanın müşterisinin "#1453 nolu
-- siparişim" mesajı o koda sahip dükkana yönlenirdi. Drizzle karşılığı: schema/platform.ts (tenants_wa_code_ck).
--
-- 1) Mevcut rakamsal kodlar yeniden üretilir. Kural packages/core/src/shared-wa.ts (waCodeBase, waCodeCandidate,
-- waCodeProblem) ile aynıdır: slug parçaları, en az 4 karakter ve bir harf olana dek birleştirilir; büyük harf, en çok
-- 10 karakter; yine harf yoksa "DKN" eki; çakışmada rakam soneki. Komut sözcükleri, sipariş koduna benzeyen (6
-- karakter, rakamlı) ve harfsiz adaylar atlanır.
DO $$
DECLARE
  t record;
  seg text;
  base text;
  cand text;
  n int;
  reserved text[] := ARRAY['DUR', 'STOP', 'START', 'BASLA', 'BASLAT', 'LISTE', 'DUKKAN', 'DUKKANLAR', 'DEGISTIR', 'YETKILI',
    'INSAN', 'OPERATOR', 'IPTAL', 'MENU', 'MERHABA', 'MRB', 'SELAM', 'SLM', 'EVET', 'HAYIR', 'TAMAM', 'SIPARIS', 'YARDIM',
    'KOD', 'TEST'];
BEGIN
  FOR t IN SELECT id, slug FROM tenants WHERE wa_code IS NOT NULL AND wa_code !~ '[A-Z]' ORDER BY created_at, id LOOP
    base := '';
    FOREACH seg IN ARRAY string_to_array(t.slug, '-') LOOP
      CONTINUE WHEN seg = '';
      base := base || seg;
      EXIT WHEN length(base) >= 4 AND base ~ '[a-z]';
    END LOOP;
    base := left(upper(regexp_replace(base, '[^a-z0-9]', '', 'g')), 10);
    IF base !~ '[A-Z]' THEN
      base := left(base, 7) || 'DKN';
    END IF;
    IF length(base) < 3 THEN
      base := left(base || 'DKN', 3);
    END IF;
    n := 1;
    LOOP
      cand := CASE WHEN n = 1 THEN base ELSE left(base, 12 - length(n::text)) || n::text END;
      EXIT WHEN cand ~ '[A-Z]'
        AND NOT (cand = ANY (reserved))
        AND NOT (cand ~ '^[A-HJ-NP-Z2-9]{6}$' AND cand ~ '[0-9]')
        AND NOT EXISTS (SELECT 1 FROM tenants x WHERE x.wa_code = cand);
      n := n + 1;
    END LOOP;
    UPDATE tenants SET wa_code = cand WHERE id = t.id;
  END LOOP;
END $$;
--> statement-breakpoint
-- 2) Kısıt: biçim + en az bir harf
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_wa_code_ck";
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_wa_code_ck" CHECK ("tenants"."wa_code" is null or ("tenants"."wa_code" ~ '^[A-Z0-9]{3,12}$' and "tenants"."wa_code" ~ '[A-Z]'));
