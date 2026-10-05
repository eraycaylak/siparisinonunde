// Görsel yükleme (14 §6.3 POST /panel/uploads): ≤ 5 MB, JPEG/PNG/WebP. Tür dosya imzasından (magic bytes)
// belirlenir; bildirilen MIME türüne güvenilmez.
//
// Yükleme ARTIK ÖZGÜN DOSYAYI SAKLAMAZ (denetim H25, Faz 3.9). Her yüklemede:
//   1. EXIF yönü uygulanır (`rotate()`), sonra TÜM metaveri DÜŞÜRÜLÜR — EXIF/GPS, IPTC, XMP, ICC. Esnafın
//      telefonuyla çektiği ürün fotoğrafı dükkânın konumunu taşıyordu; `/api/v1/uploads/*` herkese açık olduğu
//      için bu doğrudan bir KVKK sızıntısıydı (CLAUDE.md kural 7).
//   2. 320 / 640 / 1080 px genişlikte WebP varyantlar üretilir (`image-variants.ts` merdiveni; büyütme YAPILMAZ,
//      ama kaynak 1080'den darsa üst basamak kaynağın kendi genişliğidir — çözünürlük merdivene düşürülmez).
//   3. `srcset` ya da WebP anlamayan istemciler için özgün biçimde (JPEG/PNG) tek bir 640 px geri düşme karesi
//      üretilir; `url` bunu gösterir, yani veritabanına yazılan adres her istemcide çalışır.
// Mobil veride vitrin artık 5 MB'lık bir kareyi 104 px'lik kutuya indirmiyor: ~15–40 KB'lık 320 px varyantı iniyor.
//
// Özgün dosya bilerek TUTULMAZ: diskte EXIF'li bir kopya bırakmak 1. maddeyi anlamsız kılar ve 5 MB × ürün
// sayısı kadar yeri (ve yedek turunu, bkz. docs/15 §13) boşa harcar.

import type { UploadResponse } from '@siparis/core/menu/contracts';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomToken } from '../../lib/tokens';
import { FALLBACK_WIDTH, variantName, variantWidths, type VariantExtension } from './image-variants';

export type ImageType = UploadResponse['contentType'];

const EXT: Record<ImageType, VariantExtension> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * Çözülecek en büyük piksel sayısı. sharp'ın kendi varsayılanı ~268 MP'dir; 1 GiB'lik tek container'da (denetim
 * H23: OOM = tam kesinti) bu bir sıkıştırma bombası için fazlasıyla geniş. 50 MP, 50 MP'lik telefon fotoğrafına
 * yer bırakırken tavanı makul tutar.
 */
export const MAX_INPUT_PIXELS = 50_000_000;

const WEBP_QUALITY = 78;
const JPEG_QUALITY = 80;

/** Görsel okunamadı/işlenemedi. `engineUnavailable` = sharp hiç yüklenemedi (dağıtım arızası, uyarı atılır). */
export class ImageProcessingError extends Error {
  constructor(
    message: string,
    readonly engineUnavailable = false,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ImageProcessingError';
  }
}

/** Dosya imzasından görsel türü; desteklenmiyorsa null. */
export function sniffImageType(buf: Buffer): ImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

// sharp yerel (native) bir bağımlılıktır ve libvips'i süreç belleğine alır. API ve worker aynı kod tabanından
// çalıştığı için modül, ilk yüklemeye kadar HİÇ içe alınmaz (boot süresi ve RSS).
type SharpFactory = typeof import('sharp').default;
type Sharp = import('sharp').Sharp;
let sharpFactory: SharpFactory | null = null;

/**
 * libvips belleği V8 yığınının DIŞINDADIR; `--max-old-space-size` onu sınırlamaz, container sınırı sınırlar
 * (denetim H23: 1 GiB'lik tek container'da OOM = PostgreSQL dahil TAM kesinti). Bu yüzden iki varsayılan
 * kısılır:
 *   - `concurrency(1)`: libvips varsayılanı çekirdek sayısı kadar iş parçacığıdır, her biri kendi tamponuyla.
 *   - `cache(...)`: varsayılan 50 MB işlem önbelleği burada hiç işe yaramaz (her yükleme farklı dosya).
 * Değerler yükleme başına gecikmeyi birkaç yüz ms etkiler; yüklemede bu kabul edilebilir, kesinti değil.
 */
function boundSharpMemory(factory: SharpFactory): void {
  factory.concurrency(1);
  factory.cache({ memory: 16, files: 0, items: 50 });
}

async function loadSharp(): Promise<SharpFactory> {
  if (!sharpFactory) {
    let factory: SharpFactory;
    try {
      factory = (await import('sharp')).default;
    } catch (err) {
      throw new ImageProcessingError('Görsel işleyici kullanılamıyor.', true, { cause: err });
    }
    boundSharpMemory(factory);
    sharpFactory = factory;
  }
  return sharpFactory;
}

export interface SavedImage {
  /** Herkese açık adres (geri düşme karesi). Veritabanına bu yazılır. */
  url: string;
  /** Geri düşme karesinin türü = yüklenen dosyanın türü. */
  contentType: ImageType;
  /** Geri düşme karesinin bayt boyutu (yüklenen özgün dosyanın değil). */
  size: number;
  /** Diske yazılan dosya adları. */
  files: string[];
  /** Yüklenen dosyanın EXIF yönü uygulanmış ölçüsü ve bayt boyutu. */
  source: { width: number; height: number; bytes: number };
  /** En büyük varyantın ölçüsü (en-boy oranı istemciye bu adla gider). */
  largest: { width: number; height: number };
}

/** Tek yüklemenin bellekteki çıktısı. */
interface EncodedSet {
  files: Array<{ name: string; data: Buffer }>;
  fallbackName: string;
  largest: { width: number; height: number };
}

/**
 * Varyantları bellekte üretir (disk yazmaz). EXIF yönü uygulanır, metaveri düşürülür, büyütme yapılmaz.
 * `rotate()` argümansız = EXIF yönünü uygula. Metaveri varsayılan olarak çıktıya KOPYALANMAZ (sharp davranışı):
 * `withMetadata()` çağrılmadığı için EXIF/GPS, XMP, IPTC ve ICC düşer. Testte doğrulanır.
 */
async function encodeVariants(open: () => Sharp, token: string, sourceWidth: number, type: ImageType): Promise<EncodedSet> {
  const widths = variantWidths(sourceWidth);
  const maxWidth = widths[widths.length - 1]!;
  const resize = (w: number) => open().rotate().resize({ width: w, withoutEnlargement: true, fit: 'inside' });

  // En büyük varyant önce: gerçek yüksekliği (en-boy oranı) buradan okunur ve TÜM adlara yazılır.
  const largest = await resize(maxWidth).webp({ quality: WEBP_QUALITY }).toBuffer({ resolveWithObject: true });
  const maxHeight = largest.info.height;

  const files: EncodedSet['files'] = [{ name: variantName(token, maxWidth, maxHeight, maxWidth, 'webp'), data: largest.data }];
  for (const w of widths.slice(0, -1)) {
    files.push({ name: variantName(token, maxWidth, maxHeight, w, 'webp'), data: await resize(w).webp({ quality: WEBP_QUALITY }).toBuffer() });
  }

  // Geri düşme karesi: özgün biçimde, en çok 640 px (kaynak daha darsa kaynağın genişliğinde). Özgün biçim WebP
  // ise ad yukarıdaki merdiven varyantıyla çakışır ve yeniden üretilmez — uzantı ile içerik asla ayrışmaz.
  const fallbackWidth = Math.min(FALLBACK_WIDTH, maxWidth);
  const fallbackName = variantName(token, maxWidth, maxHeight, fallbackWidth, EXT[type]);
  if (!files.some((f) => f.name === fallbackName)) {
    const pipe = resize(fallbackWidth);
    const data =
      type === 'image/png'
        ? await pipe.png({ compressionLevel: 9 }).toBuffer()
        : type === 'image/jpeg'
          ? await pipe.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer()
          : await pipe.webp({ quality: WEBP_QUALITY }).toBuffer();
    files.push({ name: fallbackName, data });
  }

  return { files, fallbackName, largest: { width: maxWidth, height: maxHeight } };
}

/**
 * Görseli varyantlara ayırıp kaydeder. Döndürülen `url` geri düşme karesidir; `srcset` istemcide dosya adından
 * türer (`image-variants.ts`).
 */
export async function saveImage(uploadDirAbs: string, buf: Buffer, type: ImageType): Promise<SavedImage> {
  const sharp = await loadSharp();
  const open = () => sharp(buf, { failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true });

  // `failOn: 'none'`: kısmen bozuk ama okunabilir telefon fotoğrafı esnafın yüzüne kapatılmaz (12 §5.2 "esnaf
  // engellenmez"). Tür zaten imzadan doğrulandı, keyfi veri buraya gelmiyor.
  let width: number;
  let height: number;
  try {
    const meta = await open().metadata();
    // `autoOrient`: EXIF yönü uygulandıktan SONRAKİ ölçü (dikey çekilmiş fotoğrafta w/h yer değiştirir).
    width = meta.autoOrient?.width ?? meta.width ?? 0;
    height = meta.autoOrient?.height ?? meta.height ?? 0;
  } catch (err) {
    throw new ImageProcessingError('Görsel okunamadı.', false, { cause: err });
  }
  if (!width || !height) throw new ImageProcessingError('Görsel okunamadı.');

  const token = randomToken(18);
  let encoded: EncodedSet;
  try {
    encoded = await encodeVariants(open, token, width, type);
  } catch (err) {
    throw new ImageProcessingError('Görsel işlenemedi.', false, { cause: err });
  }

  const fallback = encoded.files.find((f) => f.name === encoded.fallbackName)!;
  // Yazma ya tamamen başarılı olur ya da hiç iz bırakmaz: yarım küme kaldığında veritabanına adres YAZILMAZ
  // (istek hata döner) ve o dosyalar diskte sonsuza dek öksüz kalırdı. Disk dolması / token çakışması gibi
  // durumlarda temizlik en iyi gayretle yapılır, asıl hata olduğu gibi yukarı gider.
  try {
    await Promise.all(encoded.files.map((f) => writeFile(join(uploadDirAbs, f.name), f.data, { flag: 'wx' })));
  } catch (err) {
    await Promise.all(encoded.files.map((f) => rm(join(uploadDirAbs, f.name), { force: true }).catch(() => {})));
    throw err;
  }

  return {
    url: `/api/v1/uploads/${fallback.name}`,
    contentType: type,
    size: fallback.data.length,
    files: encoded.files.map((f) => f.name),
    source: { width, height, bytes: buf.length },
    largest: encoded.largest,
  };
}
