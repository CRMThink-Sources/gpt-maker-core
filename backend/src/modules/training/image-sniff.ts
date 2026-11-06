import type { TrainingImageMimetype } from '@gptmaker/contracts';

/**
 * Tipo da imagem pelo conteúdo (assinatura do arquivo), não pelo nome nem pelo tipo informado:
 * `null` se não for PNG, JPEG ou WebP.
 */
export function sniffImage(
  bytes: Uint8Array,
): { mimetype: TrainingImageMimetype; ext: string } | null {
  const at = (index: number) => bytes[index];
  const ascii = (start: number, text: string) =>
    [...text].every((char, offset) => at(start + offset) === char.charCodeAt(0));

  if (
    bytes.length >= 8 &&
    at(0) === 0x89 &&
    ascii(1, 'PNG') &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  ) {
    return { mimetype: 'image/png', ext: 'png' };
  }
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    return { mimetype: 'image/jpeg', ext: 'jpg' };
  }
  if (bytes.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
    return { mimetype: 'image/webp', ext: 'webp' };
  }
  return null;
}
