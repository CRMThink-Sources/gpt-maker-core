/**
 * Anexos de uma mensagem do cliente. O `imbot.v2` não documenta onde ficam os arquivos no
 * evento (só "`params`: attach, keyboard, arquivos etc."); a v1 mandava `FILE_ID` com os ids do
 * Disco. Aceita `FILE_ID` (lista, objeto indexado do form-urlencoded, texto ou número) e listas
 * `files`/`FILES` de objetos com `id`. A confirmar com um evento real do portal.
 */
export function attachmentFileIds(params: unknown): number[] {
  const record = asRecord(params);
  if (!record) return [];
  const found = [
    ...idsFrom(record['FILE_ID']),
    ...idsFrom(record['fileId']),
    ...filesFrom(record['files']),
    ...filesFrom(record['FILES']),
  ];
  return [...new Set(found)];
}

/** Há algo em `params` que pode ser anexo, mas fora dos formatos conhecidos (para o log). */
export function hasUnknownAttachment(params: unknown): boolean {
  const record = asRecord(params);
  if (!record || attachmentFileIds(params).length) return false;
  return Object.keys(record).some((key) => /file/i.test(key));
}

export type MediaKind = 'image' | 'audio' | 'video' | 'document';

/** Variante do `/conversation` do GPTMaker pelo tipo do arquivo (ou pela extensão). */
export function mediaKindOf(contentType: string, fileName: string): MediaKind {
  const type = contentType.split(';')[0]!.trim().toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  const extension = /\.([a-z0-9]{1,10})$/i.exec(fileName)?.[1]?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic'].includes(extension)) return 'image';
  if (['mp3', 'ogg', 'oga', 'opus', 'wav', 'm4a', 'aac', 'webm'].includes(extension))
    return 'audio';
  if (['mp4', 'mov', 'avi', 'mkv', '3gp'].includes(extension)) return 'video';
  return 'document';
}

function idsFrom(value: unknown): number[] {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap(idsFrom);
  if (typeof value === 'object') return Object.values(value).flatMap(idsFrom);
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? [id] : [];
}

function filesFrom(value: unknown): number[] {
  const items = Array.isArray(value) ? value : Object.values(asRecord(value) ?? {});
  return items.flatMap((item) => idsFrom(asRecord(item)?.['id']));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
