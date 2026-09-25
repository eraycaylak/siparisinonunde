import { describe, expect, it } from 'vitest';
import { acceptWithAutoPrint, receiptUrl, receiptWindowName, type ReceiptWindowHost, type ReceiptWindowLike } from './receipt-window';

/** Sahte pencere: açılış sırası ve yönlendirmeleri kaydeder. */
function fakeHost(opts: { blocked?: boolean } = {}) {
  const log: string[] = [];
  const windows: (ReceiptWindowLike & { url: string; name: string })[] = [];
  const host: ReceiptWindowHost = {
    open(url, name) {
      log.push(`open ${url}`);
      if (opts.blocked) return null;
      const w = {
        url,
        name,
        closed: false,
        close() {
          w.closed = true;
          log.push('close');
        },
        location: {
          replace(next: string) {
            w.url = next;
            log.push(`replace ${next}`);
          },
        },
        document: { title: '', body: { textContent: '' as string | null } },
      };
      windows.push(w);
      return w;
    },
  };
  return { host, log, windows };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('onayda otomatik fiş (açılır pencere engeline takılmadan)', () => {
  it('pencere istekten önce, eşzamanlı açılır; onay başarılıysa fiş adresine yönlenir', async () => {
    const { host, log, windows } = fakeHost();
    const d = deferred<{ ok: true }>();
    const run = acceptWithAutoPrint(
      () => {
        log.push('accept');
        return d.promise;
      },
      'o-1',
      ['kitchen', 'delivery'],
      host,
    );
    // Henüz await çözülmeden: pencere açıldı (jest içinde), yer tutucu yazıldı
    expect(log).toEqual(['open about:blank', 'accept']);
    expect(windows[0]!.name).toBe(receiptWindowName('o-1', ['kitchen', 'delivery']));
    expect(windows[0]!.document?.body?.textContent).toBe('Fiş hazırlanıyor…');
    d.resolve({ ok: true });
    await expect(run).resolves.toEqual({ ok: true });
    expect(log).toEqual(['open about:blank', 'accept', 'replace /receipt/o-1?type=kitchen,delivery&auto=1']);
    expect(windows[0]!.url).toBe(receiptUrl('o-1', ['kitchen', 'delivery']));
  });

  it('onay başarısızsa pencere kapanır ve hata yeniden fırlatılır', async () => {
    const { host, log, windows } = fakeHost();
    await expect(acceptWithAutoPrint(() => Promise.reject(new Error('409')), 'o-2', ['kitchen'], host)).rejects.toThrow('409');
    expect(log).toEqual(['open about:blank', 'close']);
    expect(windows[0]!.closed).toBe(true);
  });

  it('otomatik yazdırma kapalı (tür yok): pencere açılmaz', async () => {
    const { host, log } = fakeHost();
    await acceptWithAutoPrint(() => Promise.resolve(1), 'o-3', [], host);
    expect(log).toEqual([]);
  });

  it('kullanıcı bekleme sırasında pencereyi kapattıysa yeniden açılmaz', async () => {
    const { host, log, windows } = fakeHost();
    const d = deferred<number>();
    const run = acceptWithAutoPrint(() => d.promise, 'o-4', ['kitchen'], host);
    windows[0]!.close();
    d.resolve(1);
    await run;
    expect(log).toEqual(['open about:blank', 'close']);
  });

  it('pencere engellendiyse onay yine yapılır; fiş adresi bir kez daha denenir', async () => {
    const { host, log } = fakeHost({ blocked: true });
    await expect(acceptWithAutoPrint(() => Promise.resolve('ok'), 'o-5', ['kitchen'], host)).resolves.toBe('ok');
    expect(log).toEqual(['open about:blank', 'open /receipt/o-5?type=kitchen&auto=1']);
  });
});
