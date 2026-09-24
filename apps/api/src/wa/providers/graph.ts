// Cloud API uyumlu HTTP gönderim çekirdeği (cloud ve d360 ortak). Yanıt: { messages: [{ id: wamid }] }.

import { interactiveBody, templateBody, textBody, type CloudMessageBody } from '../cloud-body';
import { WaSendError } from '../errors';
import { fetchWithTimeout } from '../http';
import { parseCloudWebhook } from '../parse';
import type { WaAccountRef, WhatsAppProvider } from '../types';
import type { WaProvider } from '@siparis/core';

export interface GraphTarget {
  url: string;
  headers: Record<string, string>;
}

type Obj = Record<string, unknown>;

/** Hata gövdesi: Cloud { error: { code, message, error_data } } ya da 360dialog { meta: {...} } / { errors: [...] }. */
function extractError(json: unknown): { code: string | null; message: string } {
  if (json && typeof json === 'object') {
    const j = json as Obj;
    const e = (j.error && typeof j.error === 'object' ? j.error : null) as Obj | null;
    if (e) {
      const details = e.error_data && typeof e.error_data === 'object' ? (e.error_data as Obj).details : undefined;
      return { code: e.code != null ? String(e.code) : null, message: String(details ?? e.message ?? 'Bilinmeyen hata') };
    }
    const errors = Array.isArray(j.errors) ? (j.errors as Obj[]) : null;
    if (errors?.[0]) return { code: errors[0].code != null ? String(errors[0].code) : null, message: String(errors[0].title ?? errors[0].message ?? '') };
    const meta = (j.meta && typeof j.meta === 'object' ? j.meta : null) as Obj | null;
    if (meta) return { code: meta.code != null ? String(meta.code) : null, message: String(meta.developer_message ?? meta.message ?? '') };
  }
  return { code: null, message: 'Bilinmeyen hata' };
}

export async function postGraphMessage(target: GraphTarget, body: CloudMessageBody): Promise<{ wamid: string }> {
  let res: Response;
  try {
    res = await fetchWithTimeout(target.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...target.headers },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new WaSendError(aborted ? 'timeout' : 'network', aborted ? 'Sağlayıcı zaman aşımı' : 'Sağlayıcıya ulaşılamadı', { retryable: true });
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    const { code, message } = extractError(json);
    throw new WaSendError(code ?? `http_${res.status}`, message, { httpStatus: res.status });
  }
  const id = (json as { messages?: { id?: string }[] } | null)?.messages?.[0]?.id;
  if (!id) throw new WaSendError('no_wamid', 'Sağlayıcı yanıtında mesaj kimliği yok', { httpStatus: res.status, retryable: false });
  return { wamid: id };
}

/** Cloud gövde üreticisini kullanan ortak sağlayıcı iskeleti. */
export function createGraphProvider(name: WaProvider, targetFor: (acc: WaAccountRef) => GraphTarget): WhatsAppProvider {
  return {
    name,
    sendText: async (acc, to, text) => postGraphMessage(targetFor(acc), textBody(to, text)),
    sendInteractive: async (acc, to, msg) => postGraphMessage(targetFor(acc), interactiveBody(to, msg)),
    sendTemplate: async (acc, to, tplName, lang, params, buttons) => postGraphMessage(targetFor(acc), templateBody(to, tplName, lang, params, buttons)),
    parseWebhook: (body) => parseCloudWebhook(body),
  };
}
