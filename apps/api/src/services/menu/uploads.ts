// Görsel yükleme (14 §6.3 POST /panel/uploads): ≤ 5 MB, JPEG/PNG/WebP. Tür dosya imzasından (magic bytes)
// belirlenir; bildirilen MIME türüne güvenilmez. Dosya UPLOAD_DIR'e rastgele adla yazılır.

import type { UploadResponse } from '@siparis/core/menu/contracts';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomToken } from '../../lib/tokens';

export type ImageType = UploadResponse['contentType'];

const EXT: Record<ImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Dosya imzasından görsel türü; desteklenmiyorsa null. */
export function sniffImageType(buf: Buffer): ImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** Görseli kaydeder ve herkese açık yolunu döner: /api/v1/uploads/<ad>. */
export async function saveImage(uploadDirAbs: string, buf: Buffer, type: ImageType): Promise<UploadResponse> {
  const name = `${randomToken(18)}.${EXT[type]}`;
  await writeFile(join(uploadDirAbs, name), buf, { flag: 'wx' });
  return { url: `/api/v1/uploads/${name}`, contentType: type, size: buf.length };
}
