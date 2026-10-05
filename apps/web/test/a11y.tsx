// Erişilebilirlik denetimi yardımcısı — axe-core + jsdom (denetim 2026-10-04 madde 4.6, EK A madde 26).
//
// NEDEN: denetim raporu "panel ve admin erişilebilirliği hiç denetlenmedi" diyordu (EK A madde 26) ve 4.6
// maddesi axe'ı kalite kapılarının parçası sayıyor. Depoda bugüne kadar tek erişilebilirlik testi
// `components/panel/panel-contrast.test.ts`ti (yalnız renk kontrastı, CSS token'larından ölçerek).
// Bu yardımcı eksik kalan yapısal tarafı kapatır: etiketsiz form alanı, bozuk ARIA, eksik erişilebilir ad,
// yanlış başlık düzeni, çift `id`, dil beyanı.
//
// KULLANIM (test dosyasının en üstüne jsdom ortamı belirtilmelidir):
//     /** @vitest-environment jsdom */
//     import { auditA11y, renderForAudit } from '@/test/a11y';
//     const screen = renderForAudit(<CheckoutPage … />);
//     expect(await auditA11y(screen.container)).toEqual([]);
//
// jsdom'UN SINIRI (bilerek kabul edildi): jsdom düzen (layout) hesaplamaz — her öğenin genişliği/yüksekliği 0,
// `getComputedStyle` gerçek rengi döndürmez. Ölçüme dayanan axe kuralları bu yüzden ya sessizce "incomplete"
// kalır ya da yanlış pozitif verir; aşağıda `LAYOUT_DEPENDENT_RULES` içinde kapatılmıştır. Gerçek kontrast ve
// dokunma hedefi ölçümü iki ayrı yerde yapılır:
//   - renk kontrastı → `components/panel/panel-contrast.test.ts` (token değerlerinden, 4,5:1 / 3:1)
//   - dokunma hedefi → Tailwind `min-h-hit` yardımcı sınıfı (12 §11.1)
// Gerçek tarayıcıda tam axe taraması Playwright işidir (e2e/, @axe-core/playwright) — FAZ 5.

import type { ReactElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import axe, { type ImpactValue, type RunOptions } from 'axe-core';

/** 12 §11.1'in bağladığı ölçüt kümesi: WCAG 2.2 AA. */
const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'] as const;

/** jsdom'da düzen olmadığı için anlamsız/yanıltıcı olan kurallar. Gerekçe için dosya başlığına bakın. */
const LAYOUT_DEPENDENT_RULES = ['color-contrast', 'color-contrast-enhanced', 'target-size', 'scrollable-region-focusable'] as const;

export interface A11yViolation {
  /** axe kural kimliği (ör. `label`, `aria-valid-attr-value`). */
  rule: string;
  impact: ImpactValue | null | undefined;
  /** Türkçeleştirilmemiş axe metni — kural kimliğiyle birlikte aranabilir olması daha değerli. */
  help: string;
  helpUrl: string;
  /** İhlalin geçtiği DOM seçicileri + axe'ın "şunu düzelt" özeti. */
  nodes: { target: string; summary: string }[];
}

export interface AuditOptions {
  /** Varsayılan: WCAG 2.2 AA. */
  tags?: readonly string[];
  /**
   * Bu denetim için bilerek atlanan kurallar. HER GİRDİ GEREKÇELİ OLMALIDIR: bir kuralı susturmak,
   * o ölçütten vazgeçmek demektir.
   */
  skipRules?: readonly string[];
}

/**
 * Verilen DOM ağacını axe ile denetler ve ihlalleri döndürür. Boş dizi = temiz.
 * Dönüşü `expect(...).toEqual([])` ile karşılaştırmak, hata çıktısında ihlalin tamamını gösterir.
 */
export async function auditA11y(root: Element, options: AuditOptions = {}): Promise<A11yViolation[]> {
  const disabled = [...LAYOUT_DEPENDENT_RULES, ...(options.skipRules ?? [])];
  const runOptions: RunOptions = {
    runOnly: { type: 'tag', values: [...(options.tags ?? WCAG_AA_TAGS)] },
    rules: Object.fromEntries(disabled.map((id) => [id, { enabled: false }])),
    // `incomplete` (axe'ın "elle bak" kovası) bilerek raporlanmıyor: jsdom'da neredeyse her ölçüm kuralı
    // buraya düşer ve test gürültüye boğulur.
    resultTypes: ['violations'],
  };
  const results = await axe.run(root, runOptions);
  return results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    helpUrl: v.helpUrl,
    nodes: v.nodes.map((n) => ({
      target: n.target.map((t) => (typeof t === 'string' ? t : JSON.stringify(t))).join(' '),
      summary: (n.failureSummary ?? '').replace(/\s+/g, ' ').trim(),
    })),
  }));
}

/** İhlalleri insan okuyabilir tek metne çevirir (CI günlüğüne basmak için). */
export function formatViolations(violations: readonly A11yViolation[]): string {
  if (violations.length === 0) return 'Erişilebilirlik ihlali yok.';
  return violations
    .map((v) => `[${v.impact ?? 'bilinmiyor'}] ${v.rule}: ${v.help}\n  ${v.nodes.map((n) => `${n.target} — ${n.summary}`).join('\n  ')}`)
    .join('\n');
}

export interface RenderedScreen {
  container: HTMLElement;
  unmount(): void;
}

/**
 * Bileşeni jsdom'a GERÇEK istemci olarak basar (`createRoot` + `act`), yani `useEffect` ve
 * `useSyncExternalStore` çalışır. `renderToStaticMarkup` BİLEREK kullanılmadı: sunucu render'ında
 * `useSyncExternalStore` sunucu anlık görüntüsünü (boş sepet) döndürür ve checkout "sepetiniz boş"
 * ekranını basar — yani denetlenmek istenen form hiç oluşmaz.
 */
export function renderForAudit(element: ReactElement): RenderedScreen {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return {
    container,
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}
