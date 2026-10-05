'use client';

// Eski tarayıcı uyarısı (04 §4.17): panel açılışında gereken CSS özellikleri yoklanır, yoksa tam genişlik kırmızı
// bant gösterilir. Bant kapatılamaz: panel gerçekten bozuk boyanıyor ve sipariş kaçma riski var.
//
// ÖNEMLİ: Bu bileşen Tailwind sınıfı KULLANMAZ, yalnız satır içi stil ve hex renk kullanır. Uyarının çıktığı durum
// tam olarak "Tailwind'in ürettiği CSS bu tarayıcıda çalışmıyor" durumudur; sınıflara güvenilse uyarının kendisi de
// görünmez olurdu (ör. `bg-band-alarm` color-mix'e düşen bir yardımcıya bağlıysa).

import { useEffect, useState, type CSSProperties } from 'react';
import {
  OLD_BROWSER_BODY,
  OLD_BROWSER_TITLE,
  PANEL_CSS_FEATURES,
  browserCssSupports,
  evaluateCssSupport,
  updateTargetFor,
  type BrowserSupportVerdict,
  type UpdateTarget,
} from './browser-support';

const BAR: CSSProperties = {
  // Bant renkleri globals.css --band-alarm / --band-alarm-fg ile aynı; token'a bakılmaz çünkü değişken çözümü de
  // bozuk olabilir.
  background: '#c81e1e',
  color: '#ffffff',
  padding: '12px 16px',
  // Dar telefonda da okunur kalsın; yazı boyutu tarayıcı ayarıyla büyüyebilsin diye rem.
  fontSize: '0.9375rem',
  lineHeight: 1.45,
  borderBottom: '2px solid #93010d',
};

const TITLE: CSSProperties = { margin: 0, fontSize: '1rem', fontWeight: 700 };
const TEXT: CSSProperties = { margin: '4px 0 0' };
const SUMMARY: CSSProperties = {
  marginTop: 8,
  cursor: 'pointer',
  fontWeight: 600,
  textDecoration: 'underline',
  // Dokunma hedefi 48 px (12 §4.2); satır içi stil olduğu için elle verilir.
  display: 'inline-block',
  minHeight: 44,
  paddingTop: 12,
};
const LIST: CSSProperties = { margin: '8px 0 0', paddingInlineStart: '1.25rem' };

/**
 * Uyarının saf görünümü (bağımlılıksız; birim testinde `renderToStaticMarkup` ile sınanır).
 * `verdict.ok` ise hiçbir şey basmaz.
 */
export function OldBrowserNoticeView({ verdict, target }: { verdict: BrowserSupportVerdict; target: UpdateTarget }) {
  if (verdict.ok) return null;
  const broken = PANEL_CSS_FEATURES.filter((f) => verdict.missing.includes(f.id));
  const version = target.currentVersion ? ` (şu an ${target.browser ?? 'tarayıcı'} ${target.currentVersion})` : '';
  return (
    <div role="alert" style={BAR} data-print-hide data-testid="eski-tarayici-uyarisi">
      <p style={TITLE}>{OLD_BROWSER_TITLE}</p>
      <p style={TEXT}>{OLD_BROWSER_BODY}</p>
      <p style={TEXT}>
        <strong>
          {target.howTo}
          {version}
        </strong>
      </p>
      <details>
        <summary style={SUMMARY}>Panelde neler bozuk?</summary>
        {verdict.probeUnavailable ? (
          <p style={TEXT}>
            Bu tarayıcı o kadar eski ki hangi özelliklerin eksik olduğunu bile söyleyemiyor. Panel renkleri, yerleşimi
            ve butonları yanlış görünebilir; sipariş kaçırma riski yüksektir.
          </p>
        ) : (
          <ul style={LIST}>
            {broken.map((f) => (
              <li key={f.id}>{f.broken}</li>
            ))}
          </ul>
        )}
        <p style={TEXT}>
          Tarayıcı güncellenene kadar siparişleri kaçırmamak için sesi açık tutun ve yeni sipariş uyarısını sesle
          takip edin.
        </p>
      </details>
    </div>
  );
}

/**
 * Panel kabuğuna takılan istemci bileşeni. Yoklama yalnız tarayıcıda, ilk boyamadan SONRA yapılır:
 * sunucu render'ında `CSS.supports` yoktur, bant sunucuda basılsa her tarayıcıda yanlışlıkla görünürdü.
 */
export function OldBrowserNotice() {
  const [state, setState] = useState<{ verdict: BrowserSupportVerdict; target: UpdateTarget } | null>(null);

  useEffect(() => {
    const verdict = evaluateCssSupport(browserCssSupports());
    if (verdict.ok) return;
    setState({ verdict, target: updateTargetFor(navigator.userAgent) });
  }, []);

  if (!state) return null;
  return <OldBrowserNoticeView verdict={state.verdict} target={state.target} />;
}
