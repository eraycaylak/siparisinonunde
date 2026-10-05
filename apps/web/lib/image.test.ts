// Duyarlı görsel adresleri: varyant çözme, srcset üretimi ve GERİYE DÖNÜK UYUM (eski/dış adresler).
// Çalıştır: pnpm --filter @siparis/web test

import { describe, expect, it } from 'vitest';
import { VARIANT_WIDTHS, responsiveImage, variantWidths } from './image';

const U = '/api/v1/uploads/';
const TOKEN = 'kQ7v4a-_x9AbCdEfGh';

describe('variantWidths', () => {
  it('sunucu tarafıyla aynı merdiven kuralı (büyütme yok)', () => {
    expect(VARIANT_WIDTHS).toEqual([320, 640, 1080]);
    expect(variantWidths(1080)).toEqual([320, 640, 1080]);
    expect(variantWidths(640)).toEqual([320, 640]);
    expect(variantWidths(320)).toEqual([320]);
    expect(variantWidths(200)).toEqual([200]);
  });

  it('merdiven basamağı OLMAYAN maxWidth: üst basamak kaynağın kendi genişliğidir', () => {
    // Sunucu 1024 px'lik kaynağa `…1024x768.…` yazar; istemci o sayıdan aynı listeyi kurmak zorundadır.
    expect(variantWidths(1024)).toEqual([320, 640, 1024]);
    expect(variantWidths(1079)).toEqual([320, 640, 1079]);
    expect(variantWidths(400)).toEqual([320, 400]);
  });
});

describe('responsiveImage: varyantlı adres', () => {
  it('3 basamaklı WebP srcset + gerçek ölçü + sizes üretir', () => {
    const img = responsiveImage(`${U}${TOKEN}.1080x608.640.jpg`, '104px');
    expect(img).toEqual({
      src: `${U}${TOKEN}.1080x608.640.jpg`,
      webpSrcSet: [
        `${U}${TOKEN}.1080x608.320.webp 320w`,
        `${U}${TOKEN}.1080x608.640.webp 640w`,
        `${U}${TOKEN}.1080x608.1080.webp 1080w`,
      ].join(', '),
      sizes: '104px',
      width: 1080,
      height: 608,
    });
  });

  it('src özgün biçimi gösterir; srcset yalnız WebP taşır (<source type="image/webp">)', () => {
    const img = responsiveImage(`${U}${TOKEN}.1080x608.640.png`)!;
    expect(img.src.endsWith('.png')).toBe(true);
    expect(img.webpSrcSet).not.toContain('.png');
  });

  it('küçük kaynakta tek basamak üretir (sunucu da tek varyant yazmıştı)', () => {
    const img = responsiveImage(`${U}${TOKEN}.200x100.200.png`)!;
    expect(img.webpSrcSet).toBe(`${U}${TOKEN}.200x100.200.webp 200w`);
    expect(img.width).toBe(200);
    expect(img.height).toBe(100);
  });

  it('merdiven dışı üst basamak srcset’e olduğu gibi girer', () => {
    const img = responsiveImage(`${U}${TOKEN}.1024x768.640.jpg`, '96px')!;
    expect(img.webpSrcSet).toBe(
      [
        `${U}${TOKEN}.1024x768.320.webp 320w`,
        `${U}${TOKEN}.1024x768.640.webp 640w`,
        `${U}${TOKEN}.1024x768.1024.webp 1024w`,
      ].join(', '),
    );
    expect(img.width).toBe(1024);
  });

  it('özgün biçim WebP olduğunda src de varyant kümesinin içindedir', () => {
    const img = responsiveImage(`${U}${TOKEN}.1080x1080.640.webp`)!;
    expect(img.webpSrcSet).toContain(`${U}${TOKEN}.1080x1080.640.webp 640w`);
  });

  it('sizes verilmezse alan hiç eklenmez', () => {
    expect(responsiveImage(`${U}${TOKEN}.1080x608.640.jpg`)).not.toHaveProperty('sizes');
  });
});

describe('responsiveImage: GERİYE DÖNÜK UYUM', () => {
  // Var olmayan bir varyantı srcset'e koymak tarayıcıyı src'ye geri DÜŞÜRMEZ, görseli tamamen kırar.
  // Bu yüzden varyantı olmadığını bildiğimiz her adreste srcset ÜRETİLMEMELİ.
  it('Faz 1 yüklemesi (varyantsız) tek src ile çizilir', () => {
    const legacy = `${U}kQ7v4a-_x9AbCdEfGh.png`;
    expect(responsiveImage(legacy, '104px')).toEqual({ src: legacy });
  });

  it('elle girilmiş dış adres (https) tek src ile çizilir', () => {
    const ext = 'https://ornek.example/menu/pide.jpg';
    expect(responsiveImage(ext, '104px')).toEqual({ src: ext });
  });

  it('bozuk/eksik ölçü bölümü olan adresler srcset üretmez', () => {
    for (const name of [`${TOKEN}.1080x.640.webp`, `${TOKEN}.0x608.640.webp`, `${TOKEN}.1080x608.640.gif`, `${TOKEN}.1080x608.webp`]) {
      expect(responsiveImage(`${U}${name}`), name).toEqual({ src: `${U}${name}` });
    }
  });

  it('boş/null/yalnız boşluk adres null döner', () => {
    expect(responsiveImage(null)).toBeNull();
    expect(responsiveImage(undefined)).toBeNull();
    expect(responsiveImage('')).toBeNull();
    expect(responsiveImage('   ')).toBeNull();
  });
});

describe('responsiveImage: güvenlik', () => {
  it('yol çıkma denemesi srcset üretmez', () => {
    const evil = `${U}../../../etc/passwd.1080x608.640.jpg`;
    expect(responsiveImage(evil)).toEqual({ src: evil });
  });

  it('en büyük varyanttan geniş bir basamak iddia eden ad reddedilir', () => {
    const bogus = `${U}${TOKEN}.320x240.1080.webp`;
    expect(responsiveImage(bogus)).toEqual({ src: bogus });
  });

  it('srcset adresleri çözülen parçalardan yeniden kurulur: başka origin sızamaz', () => {
    const img = responsiveImage(`${U}${TOKEN}.1080x608.640.jpg`)!;
    for (const candidate of img.webpSrcSet!.split(', ')) {
      expect(candidate.startsWith(U)).toBe(true);
      expect(candidate).not.toContain('..');
    }
  });
});
