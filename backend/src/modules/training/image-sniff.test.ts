import { describe, expect, it } from 'vitest';
import { sniffImage } from './image-sniff';

const bytes = (...values: number[]) => Uint8Array.from(values);

describe('sniffImage', () => {
  it('reconhece PNG, JPEG e WebP pela assinatura', () => {
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))?.mimetype).toBe(
      'image/png',
    );
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))?.mimetype).toBe('image/jpeg');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
    expect(sniffImage(webp)?.mimetype).toBe('image/webp');
  });

  it('recusa PDF, texto e arquivo vazio, mesmo com nome de imagem', () => {
    expect(sniffImage(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(sniffImage(Buffer.from('<svg></svg>'))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });

  it('RIFF que não é WebP (ex.: WAV) é recusado', () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')]);
    expect(sniffImage(wav)).toBeNull();
  });
});
