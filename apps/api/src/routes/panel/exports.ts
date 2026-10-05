// Panel toplu dışa aktarma (açık soru 10 — kullanım koşullarındaki "verilerinizi dışa aktarabilirsiniz" taahhüdü).
//
//   GET /panel/exports/orders.csv      · GET /panel/exports/orders.json      (tarih aralığı: varsayılan son 30 gün)
//   GET /panel/exports/customers.csv   · GET /panel/exports/customers.json   (tarih aralığı isteğe bağlı)
//
// Kapılar:
//   - Rol: yalnız owner/manager. Kasiyer ve mutfak toplu kişisel veri indirmez (00 §4).
//   - Tenant kapsamı zorunlu; şube kısıtlı üyelik kendi şubesinin dışına çıkamaz (assertBranchAccess + ExportScope).
//   - `includePersonal=1` açık telefon/adres/koordinat verir; DESTEK OTURUMUNDA (impersonation) reddedilir:
//     platform personeli işletmenin tüm müşteri telefon ve adres dosyasını tek istekle indirmemeli (05 A-09).
//   - Hız sınırı işletme başına + süreç genelinde eşzamanlılık kapısı: 1/4 vCPU + 1 GiB kutuda (açık soru 5) aynı
//     anda açılan birkaç büyük dışa aktarma paneli yavaşlatır. Kapıya takılan 429 + Retry-After alır.
//   - Denetim kaydı istek anında yazılır (akış yarıda kopsa bile kim ne istedi kayıtlı kalır).
//
// Akış: yanıt gövdesi bir Node akışıdır; satırlar keyset öbekleriyle okunup anında yazılır (services/reports/export).
// Akış ortasında veritabanı hatası olursa hata BİLEREK yukarı atılır: bağlantı koparılır, istemci "indirme
// başarısız" görür. Yarım ama geçerli görünen bir dosya vermek (sessiz veri kaybı) en kötü sonuçtur.

import { tenants } from '@siparis/db';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { audit, auditActor } from '../../lib/audit';
import { forbidden, tooManyRequests } from '../../lib/errors';
import { createRateLimiter, enforceRateLimit } from '../../lib/rate-limit';
import {
  csvChunks,
  jsonChunks,
  type JsonExportMeta,
} from '../../services/reports/export-format';
import { customerCsvCells, CUSTOMER_CSV_HEADER, exportCustomers } from '../../services/reports/export-customers';
import { exportOrders, ORDER_CSV_HEADER, orderCsvCells } from '../../services/reports/export-orders';
import { parseExportRange, parseOptionalRange, type ExportRange, type ExportScope } from '../../services/reports/export';
import { assertBranchAccess, requireTenantRole, tenantAuth } from '../../plugins/auth';

/** 14 §5 dilinde hız sınırı: işletme başına 10 dakikada 5 dosya. */
export const EXPORT_RATE_LIMIT = { limit: 5, windowMs: 10 * 60_000 } as const;
/** Süreç genelinde aynı anda akan dışa aktarma sayısı (küçük container; açık soru 5). */
export const EXPORT_MAX_CONCURRENT = 2;
/** Eşzamanlılık kapısına takılan istemciye verilen bekleme süresi. */
export const EXPORT_BUSY_RETRY_SEC = 30;

const exportLimiter = createRateLimiter(EXPORT_RATE_LIMIT);
let active = 0;

/** Testler için: hız sınırı kovalarını ve eşzamanlılık sayacını sıfırlar. */
export function resetExportLimits(): void {
  exportLimiter.reset();
  active = 0;
}

/** Açık akış sayısı (test ve teşhis). */
export function activeExportCount(): number {
  return active;
}

const rangeQuery = z.object({
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  branchId: z.uuid().optional(),
  includePersonal: z.enum(['1', '0', 'true', 'false']).optional(),
});

type RangeQuery = z.infer<typeof rangeQuery>;

const OM = ['owner', 'manager'] as const;

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'isletme';
}

const exportRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Rol + şube + hız sınırı + eşzamanlılık kapısı; `release` akış bitince çağrılır. */
  async function prepare(
    request: { query: RangeQuery } & Parameters<typeof tenantAuth>[0],
    kind: 'orders' | 'customers',
  ): Promise<{ scope: ExportScope; includePersonal: boolean; filenameBase: string; release: () => void }> {
    const auth = tenantAuth(request);
    const branchId = request.query.branchId ?? auth.branchId ?? null;
    if (branchId) await assertBranchAccess(app.db, auth, branchId);

    const includePersonal = request.query.includePersonal === '1' || request.query.includePersonal === 'true';
    if (includePersonal && auth.session.kind === 'impersonation') {
      throw forbidden('Destek görünümünde kişisel veri içeren toplu dosya indirilemez.', 'impersonation_export_blocked');
    }

    enforceRateLimit(exportLimiter, `${kind}:${auth.tenantId}`);
    // Dosya adı için gereken sorgu kapıdan ÖNCE: burada patlarsa sayaç hiç artmaz, slot sızmaz
    const [tenant] = await app.db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, auth.tenantId));

    if (active >= EXPORT_MAX_CONCURRENT) throw tooManyRequests(EXPORT_BUSY_RETRY_SEC);
    active++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active--;
    };
    return { scope: { tenantId: auth.tenantId, branchId }, includePersonal, filenameBase: slugify(tenant?.slug ?? ''), release };
  }

  /** Akışı Fastify'a verir; `release` her sonda (bitti, hata, istemci koptu) bir kez çalışır. */
  function send(
    reply: { header: (k: string, v: string) => unknown; raw: ServerResponse },
    chunks: AsyncGenerator<string>,
    opts: { contentType: string; filename: string; release: () => void },
  ): Readable {
    // Akış hiç tüketilmeden yanıt kapanırsa (istemci koptu, seri hale getirme hatası) kapı yine bırakılır;
    // `release` bir kez çalışacak biçimde yazılmıştır
    reply.raw.once('close', opts.release);
    reply.header('content-type', opts.contentType);
    reply.header('content-disposition', `attachment; filename="${opts.filename}"`);
    reply.header('cache-control', 'no-store');
    // Dosya uzunluğu önceden bilinmez: content-length yok, akış kapanınca dosya biter
    reply.header('x-content-type-options', 'nosniff');
    const guarded = (async function* () {
      try {
        yield* chunks;
      } finally {
        opts.release();
      }
    })();
    // objectMode kapalı: geri basınç parça SAYISI yerine BAYT üzerinden işler (büyük dosyada bellek tavanı)
    return Readable.from(guarded, { objectMode: false });
  }

  const today = () => new Date().toISOString().slice(0, 10);

  function jsonMeta(kind: 'orders' | 'customers', scope: ExportScope, range: ExportRange | null, includePersonal: boolean): JsonExportMeta {
    return {
      kind,
      scope: { tenantId: scope.tenantId, branchId: scope.branchId ?? null },
      range: range ? { from: range.fromDate, to: range.toDate } : null,
      includesPersonalData: includePersonal,
    };
  }

  async function auditExport(
    request: Parameters<typeof auditActor>[0],
    kind: 'orders' | 'customers',
    format: 'csv' | 'json',
    scope: ExportScope,
    range: ExportRange | null,
    includePersonal: boolean,
  ): Promise<void> {
    await audit(app.db, {
      ...auditActor(request),
      action: `export.${kind}`,
      entityType: 'tenant',
      entityId: scope.tenantId,
      data: {
        format,
        branchId: scope.branchId ?? null,
        from: range?.fromDate ?? null,
        to: range?.toDate ?? null,
        includePersonal,
      },
    });
  }

  // --- Siparişler ---------------------------------------------------------------------------------

  for (const format of ['csv', 'json'] as const) {
    app.get(`/exports/orders.${format}`, { preHandler: requireTenantRole(OM), schema: { querystring: rangeQuery } }, async (request, reply) => {
      const { scope, includePersonal, filenameBase, release } = await prepare(request, 'orders');
      try {
        const range = parseExportRange(request.query.from, request.query.to);
        await auditExport(request, 'orders', format, scope, range, includePersonal);
        const rows = exportOrders(app.db, scope, range, { includePersonal });
        const chunks =
          format === 'csv' ? csvChunks(ORDER_CSV_HEADER, rows, orderCsvCells) : jsonChunks(jsonMeta('orders', scope, range, includePersonal), rows);
        return send(reply, chunks, {
          contentType: format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
          filename: `siparisler-${filenameBase}-${range.fromDate}_${range.toDate}.${format}`,
          release,
        });
      } catch (err) {
        // Akış başlamadan hata (doğrulama, denetim kaydı): kapı hemen bırakılır
        release();
        throw err;
      }
    });
  }

  // --- Müşteriler ---------------------------------------------------------------------------------

  for (const format of ['csv', 'json'] as const) {
    app.get(`/exports/customers.${format}`, { preHandler: requireTenantRole(OM), schema: { querystring: rangeQuery } }, async (request, reply) => {
      const { scope, includePersonal, filenameBase, release } = await prepare(request, 'customers');
      try {
        const range = parseOptionalRange(request.query.from, request.query.to);
        await auditExport(request, 'customers', format, scope, range, includePersonal);
        const rows = exportCustomers(app.db, scope, range, { includePersonal });
        const chunks =
          format === 'csv'
            ? csvChunks(CUSTOMER_CSV_HEADER, rows, customerCsvCells)
            : jsonChunks(jsonMeta('customers', scope, range, includePersonal), rows);
        const span = range ? `${range.fromDate}_${range.toDate}` : today();
        return send(reply, chunks, {
          contentType: format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
          filename: `musteriler-${filenameBase}-${span}.${format}`,
          release,
        });
      } catch (err) {
        release();
        throw err;
      }
    });
  }
};

export default exportRoutes;
