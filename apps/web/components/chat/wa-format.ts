// WhatsApp metin biçimi (*kalın*, _italik_, ~üstü çizili~) → parçalar. Ortak numarada (00 §12a madde 8) her mesaj
// "*Dükkan adı*" satırıyla başlar; panel sohbeti ve simülatör bunu WhatsApp'taki gibi kalın gösterir. İç içe biçim
// yok; işaretler kelime sınırında olmalı (WhatsApp kuralı: "a*b*c" biçimlenmez), işaretin içi boşlukla başlayıp bitemez.

export interface WaTextPart {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
}

const MARK_RE = /(?<![\p{L}\p{N}])([*_~])([^\s*_~](?:[^\n]*?[^\s])?)\1(?![\p{L}\p{N}])/gu;

export function parseWaFormat(text: string): WaTextPart[] {
  const parts: WaTextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(MARK_RE)) {
    const inner = m[2]!;
    // İşaret içeride tekrar geçiyorsa (ör. "*a* ve *b*" yanlış eşleşmesi) atla
    if (inner.includes(m[1]!)) continue;
    const at = m.index!;
    if (at > last) parts.push({ text: text.slice(last, at) });
    const mark = m[1];
    parts.push({ text: inner, ...(mark === '*' ? { bold: true } : mark === '_' ? { italic: true } : { strike: true }) });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts.length ? parts : [{ text }];
}
