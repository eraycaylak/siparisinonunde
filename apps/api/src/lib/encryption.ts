// AES-256-GCM ile gizli değer şifreleme (WhatsApp/SMS API anahtarları). Biçim: v1:<iv>:<tag>:<şifreli> (base64)

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface Encryptor {
  encrypt(plain: string): string;
  decrypt(payload: string): string;
}

export function createEncryptor(keyBase64: string): Encryptor {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY 32 bayt olmalı');
  return {
    encrypt(plain: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
    },
    decrypt(payload: string): string {
      const [v, ivB64, tagB64, ctB64] = payload.split(':');
      if (v !== 'v1' || !ivB64 || !tagB64 || ctB64 === undefined) throw new Error('Geçersiz şifreli değer');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
    },
  };
}
