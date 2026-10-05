// Görsel yükleme servisi (Faz 3.9, denetim H25): varyant üretimi, EXIF/GPS temizliği, büyütmeme kuralı,
// adlandırma sözleşmesi ve eski adlarda geriye dönük uyum. Veritabanı gerektirmez.
//
// Çalıştır: ALLOW_DB_RESET=1 pnpm test  (yalnız bu dosya: pnpm vitest run apps/api/test/uploads.test.ts)

import { randomFillSync } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import {
  FALLBACK_WIDTH,
  VARIANT_WIDTHS,
  parseVariantName,
  variantName,
  variantWidths,
} from '../src/services/menu/image-variants';
import { ImageProcessingError, saveImage, sniffImageType } from '../src/services/menu/uploads';

const dirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'siparis-uploads-test-'));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** Varyant adından token (token nokta içermez). */
const tokenOf = (name: string) => parseVariantName(name)!.token;

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#c0392b' } });

describe('image-variants: adlandırma sözleşmesi', () => {
  it('merdiven kaynaktan geniş basamakları atlar (görsel BÜYÜTÜLMEZ)', () => {
    expect(variantWidths(4000)).toEqual([320, 640, 1080]);
    expect(variantWidths(1080)).toEqual([320, 640, 1080]);
    expect(variantWidths(640)).toEqual([320, 640]);
  });

  it('üst basamak merdivene DÜŞÜRÜLMEZ: kaynağın çözünürlüğü atılmaz', () => {
    // 1024 px'lik kaynak eskiden 640'a inerdi; genişliğin %40'ı sebepsiz gidiyordu
    expect(variantWidths(1024)).toEqual([320, 640, 1024]);
    expect(variantWidths(1079)).toEqual([320, 640, 1079]);
    expect(variantWidths(400)).toEqual([320, 400]);
  });

  it('üst basamak altındakine çok yakınsa ikiz dosya yazılmaz (< %15)', () => {
    expect(variantWidths(321)).toEqual([320]);
    expect(variantWidths(700)).toEqual([320, 640]);
    expect(variantWidths(736)).toEqual([320, 640, 736]);
  });

  it('kaynak 320 px’den darsa tek varyant kaynağın kendi genişliğindedir', () => {
    expect(variantWidths(200)).toEqual([200]);
    expect(variantWidths(320)).toEqual([320]);
    expect(variantWidths(1)).toEqual([1]);
  });

  it('SÖZLEŞME: adda duran maxWidth ile çağrı aynı listeyi verir (sunucu ↔ istemci)', () => {
    // Sunucu adı `widths[son]` ile yazar; istemci o sayıyla listeyi yeniden kurar. İkisi ayrışırsa
    // istemci var olmayan bir varyantı srcset'e koyar ve görsel tamamen kırılır.
    for (const source of [1, 50, 200, 319, 320, 321, 400, 639, 640, 700, 736, 1000, 1024, 1079, 1080, 1600, 4000]) {
      const widths = variantWidths(source);
      const maxWidth = widths[widths.length - 1]!;
      expect(variantWidths(maxWidth), `kaynak ${source}`).toEqual(widths);
    }
  });

  it('ad üret → çöz gidiş-dönüşü', () => {
    const name = variantName('abc-DEF_123', 1080, 608, 640, 'webp');
    expect(name).toBe('abc-DEF_123.1080x608.640.webp');
    expect(parseVariantName(name)).toEqual({ token: 'abc-DEF_123', maxWidth: 1080, maxHeight: 608, width: 640, ext: 'webp' });
  });

  it('GERİYE DÖNÜK UYUM: eski/dış adlar kalıba uymaz → null (istemci srcset üretmez)', () => {
    // Faz 1 adlandırması
    expect(parseVariantName('kQ7v4a-_x9.png')).toBeNull();
    expect(parseVariantName('logo.jpg')).toBeNull();
    // Eksik ya da bozuk ölçü bölümü
    expect(parseVariantName('tok.1080x.640.webp')).toBeNull();
    expect(parseVariantName('tok.0x608.640.webp')).toBeNull();
    expect(parseVariantName('tok.1080x608.640.gif')).toBeNull();
    // Varyant en büyük varyanttan geniş olamaz (uydurulmuş ad)
    expect(parseVariantName('tok.320x240.1080.webp')).toBeNull();
    // Yol çıkma denemesi
    expect(parseVariantName('../../etc/passwd.1080x608.640.webp')).toBeNull();
  });

  it('merdiven ve geri düşme genişliği belgelenen değerlerdedir', () => {
    expect(VARIANT_WIDTHS).toEqual([320, 640, 1080]);
    expect(FALLBACK_WIDTH).toBe(640);
  });
});

describe('saveImage: varyant üretimi', () => {
  it('büyük JPEG → 320/640/1080 WebP + 640 px JPEG geri düşme karesi; url geri düşmeyi gösterir', async () => {
    const dir = freshDir();
    const buf = await solid(1600, 900).jpeg().toBuffer();
    const saved = await saveImage(dir, buf, 'image/jpeg');

    expect(saved.source).toMatchObject({ width: 1600, height: 900, bytes: buf.length });
    expect(saved.largest.width).toBe(1080);
    // En-boy oranı korunur (16:9); kesin yükseklik libvips yuvarlamasına bağlı
    expect(saved.largest.width / saved.largest.height).toBeCloseTo(1600 / 900, 2);
    expect(saved.contentType).toBe('image/jpeg');

    const token = tokenOf(saved.files[0]!);
    const { width: mw, height: mh } = saved.largest;
    expect([...saved.files].sort()).toEqual(
      [
        variantName(token, mw, mh, 320, 'webp'),
        variantName(token, mw, mh, 640, 'webp'),
        variantName(token, mw, mh, 1080, 'webp'),
        variantName(token, mw, mh, 640, 'jpg'),
      ].sort(),
    );

    // url = 640 px JPEG (her istemcide çalışan kare)
    expect(saved.url).toBe(`/api/v1/uploads/${variantName(token, mw, mh, 640, 'jpg')}`);
    expect(parseVariantName(saved.url.split('/').pop()!)).toMatchObject({ maxWidth: 1080, width: 640, ext: 'jpg' });

    // Diskteki her dosya gerçekten adının söylediği genişlikte ve biçimde
    for (const name of saved.files) {
      const p = parseVariantName(name)!;
      const meta = await sharp(readFileSync(join(dir, name))).metadata();
      expect(meta.width, name).toBe(p.width);
      expect(meta.format, name).toBe(p.ext === 'jpg' ? 'jpeg' : p.ext);
    }
  });

  it('5 MB’lık özgün dosya yerine çok daha küçük kareler servis edilir (mobil veri)', async () => {
    const dir = freshDir();
    // Gürültülü büyük fotoğraf: sıkıştırılamayan içerik → özgün dosya iri olur (gerçek fotoğraf gibi)
    const noise = randomFillSync(Buffer.alloc(1600 * 1200 * 3));
    const buf = await sharp(noise, { raw: { width: 1600, height: 1200, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();

    const saved = await saveImage(dir, buf, 'image/jpeg');
    const smallest = saved.files.find((f) => parseVariantName(f)!.width === 320 && parseVariantName(f)!.ext === 'webp')!;
    const smallBytes = readFileSync(join(dir, smallest)).length;

    expect(smallBytes).toBeLessThan(buf.length);
    // Vitrin kartının 104 px'lik kutusuna inen kare, özgün dosyanın küçük bir kesridir
    expect(smallBytes * 5).toBeLessThan(buf.length);
  });

  it('özgün biçim WebP ise ayrı geri düşme karesi üretilmez (uzantı ile içerik ayrışmaz)', async () => {
    const dir = freshDir();
    const buf = await solid(1200, 1200).webp().toBuffer();
    const saved = await saveImage(dir, buf, 'image/webp');

    expect(saved.files).toHaveLength(3);
    expect(saved.files.every((f) => f.endsWith('.webp'))).toBe(true);
    expect(saved.url.endsWith('.640.webp')).toBe(true);
  });

  it('PNG saydamlığı korunur (logo)', async () => {
    const dir = freshDir();
    const buf = await sharp({ create: { width: 800, height: 800, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0.4 } } }).png().toBuffer();
    const saved = await saveImage(dir, buf, 'image/png');

    const fallback = saved.url.split('/').pop()!;
    expect(fallback.endsWith('.640.png')).toBe(true);
    const meta = await sharp(readFileSync(join(dir, fallback))).metadata();
    expect(meta.format).toBe('png');
    expect(meta.hasAlpha).toBe(true);
  });
});

describe('saveImage: EXIF / GPS temizliği (KVKK, CLAUDE.md kural 7)', () => {
  it('EXIF/GPS yüklenen dosyada VARDIR, kaydedilen hiçbir varyantta YOKTUR', async () => {
    const dir = freshDir();
    // libvips/sharp adlandırması: IFD3 = GPS IFD'si (IFD0 ana, IFD1 küçük resim, IFD2 Exif alt-IFD'si)
    const buf = await solid(1600, 900)
      .jpeg()
      .withExif({
        IFD0: { Make: 'TestPhoneGPS', Model: 'Model-X' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '39/1 48/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '34/1 49/1 0/1' },
      })
      .toBuffer();

    // Ön koşul: girdi gerçekten konum verisi taşıyor. 0x8825 = GPS IFD işaretçisi etiketi; sharp'ın yazdığı
    // TIFF başlığı küçük-sonlu ("II") olduğu için baytlar ters sırada, yani hex'te '2588' olarak görünür.
    const sourceExif = (await sharp(buf).metadata()).exif!;
    expect(sourceExif.toString('hex')).toContain('2588');
    expect(buf.includes(Buffer.from('TestPhoneGPS'))).toBe(true);

    const saved = await saveImage(dir, buf, 'image/jpeg');
    for (const name of saved.files) {
      const bytes = readFileSync(join(dir, name));
      const meta = await sharp(bytes).metadata();
      expect(meta.exif, name).toBeUndefined();
      expect(meta.xmp, name).toBeUndefined();
      expect(meta.icc, name).toBeUndefined();
      // Metaveri bloğu düşmüş: üretici dizgisi ham baytlarda da yok
      expect(bytes.includes(Buffer.from('TestPhoneGPS')), name).toBe(false);
    }
  });

  it('EXIF yönü UYGULANIR: dikey çekilmiş fotoğrafta ölçüler takla atar', async () => {
    const dir = freshDir();
    // Orientation 6 = 90° saat yönünde çevir → 1200×600 ham kare, görünen ölçü 600×1200
    const buf = await solid(1200, 600).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const saved = await saveImage(dir, buf, 'image/jpeg');

    expect(saved.source).toMatchObject({ width: 600, height: 1200 });
    // 600 px genişliğinde kaynak → 320 basamağı + kaynağın kendi genişliği (büyütme yok, düşürme de yok)
    expect(saved.largest.width).toBe(600);
    expect(saved.largest.height).toBe(1200);

    const largest = saved.files.find((f) => f.endsWith('.600.webp'))!;
    const meta = await sharp(readFileSync(join(dir, largest))).metadata();
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(1200);
    // Çevrilmiş kare bir daha çevrilmesin diye yön etiketi de kalmaz
    expect(meta.orientation).toBeUndefined();
  });
});

describe('saveImage: kenar durumlar', () => {
  it('320 px’den dar görsel BÜYÜTÜLMEZ; tek genişlikte webp + özgün biçim kaydedilir', async () => {
    const dir = freshDir();
    const buf = await solid(200, 100).png().toBuffer();
    const saved = await saveImage(dir, buf, 'image/png');

    expect(saved.largest).toEqual({ width: 200, height: 100 });
    expect(saved.files).toHaveLength(2);
    expect(saved.files.map((f) => parseVariantName(f)!.width)).toEqual([200, 200]);
    expect(saved.url.endsWith('.200x100.200.png')).toBe(true);
  });

  it('okunamayan içerik ImageProcessingError atar (uç nokta 415’e çevirir), dosya yazılmaz', async () => {
    const dir = freshDir();
    // Geçerli PNG imzası + çöp gövde: sniff PNG der, çözücü çözemez
    const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
    expect(sniffImageType(fake)).toBe('image/png');
    await expect(saveImage(dir, fake, 'image/png')).rejects.toBeInstanceOf(ImageProcessingError);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('yazma başarısızsa hata yutulmaz ve yarım dosya kümesi bırakılmaz', async () => {
    const dir = freshDir();
    const missing = join(dir, 'olmayan-dizin');
    const buf = await solid(800, 600).jpeg().toBuffer();
    await expect(saveImage(missing, buf, 'image/jpeg')).rejects.toThrow();
    // Temizlik denemesi dizini ya da başka bir şeyi yaratmaz
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('libvips belleği sınırlanır (1 GiB container, denetim H23)', async () => {
    const dir = freshDir();
    await saveImage(dir, await solid(400, 400).png().toBuffer(), 'image/png');
    // `saveImage` ilk çağrıda sharp'ı yükleyip varsayılanları kısar; süreç genelinde geçerlidir
    expect(sharp.concurrency()).toBe(1);
    expect(sharp.cache().memory.max).toBe(16);
  });

  it('her yükleme rastgele ve çakışmayan bir token alır', async () => {
    const dir = freshDir();
    const buf = await solid(400, 400).jpeg().toBuffer();
    const a = await saveImage(dir, buf, 'image/jpeg');
    const b = await saveImage(dir, buf, 'image/jpeg');
    expect(parseVariantName(a.files[0]!)!.token).not.toBe(parseVariantName(b.files[0]!)!.token);
    expect(readdirSync(dir)).toHaveLength(a.files.length + b.files.length);
  });
});
