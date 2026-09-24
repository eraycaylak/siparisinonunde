// WhatsApp katmanı: sağlayıcılar (mock | cloud | d360), Cloud gövde üretici, webhook ayrıştırıcı, imza, hata eşlemesi.
export type * from './types';
export { clip, interactiveBody, recipientFields, templateBody, textBody, type CloudMessageBody } from './cloud-body';
export { WaSendError, classifyWaErrorCode, isWaSendError, waErrorSummary, type WaErrorAction } from './errors';
export { fetchWithTimeout, httpFetch, setHttpFetch, type FetchLike } from './http';
export { parseCloudWebhook, waIdToE164 } from './parse';
export { getWaProvider, maskApiKey, toAccountRef, encryptorFor, type WaAccountRow } from './registry';
export { signMetaPayload, verifyMetaSignature } from './signature';
export { acquireNumberSlot, NUMBER_RATE_PER_SEC, PAIR_INTERVAL_MS, resetNumberSlots } from './throttle';
export { clearMockSent, mockFailNext, mockSentMessages, type MockSentEntry } from './providers/mock';
export { GRAPH_API_VERSION, GRAPH_BASE_URL } from './providers/cloud';
export { D360_BASE_URL } from './providers/d360';
