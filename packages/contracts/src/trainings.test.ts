import { describe, expect, it } from 'vitest';
import {
  TRAINING_IMPORT_MAX_ITEMS,
  trainingExportSchema,
  trainingImportRequestSchema,
  trainingTransferItemSchema,
} from './trainings';

const IMAGE_URL = 'https://api.exemplo.com/public/training-images/abc123';

describe('arquivo de exportação de treinamentos', () => {
  it.each([
    ['texto', { type: 'TEXT', text: 'Preços' }],
    ['texto com imagem', { type: 'TEXT', text: 'Preços', imageUrl: IMAGE_URL }],
    ['site', { type: 'WEBSITE', url: 'https://exemplo.com', trainingSubPages: true }],
    ['vídeo', { type: 'VIDEO', url: 'https://youtu.be/x' }],
  ])('aceita item de %s', (_nome, item) => {
    expect(trainingTransferItemSchema.safeParse(item).success).toBe(true);
  });

  it('site assume os padrões da criação', () => {
    expect(
      trainingTransferItemSchema.parse({ type: 'WEBSITE', url: 'https://exemplo.com' }),
    ).toMatchObject({ trainingSubPages: false, trainingInterval: 'NEVER' });
  });

  it.each([
    ['managed', { type: 'TEXT', text: 'x', managed: true }],
    ['imageId', { type: 'TEXT', text: 'x', imageId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' }],
    ['documentKey', { type: 'TEXT', text: 'x', documentKey: 'k' }],
    ['id', { type: 'VIDEO', url: 'https://youtu.be/x', id: 'abc' }],
    ['imageUrl em site', { type: 'WEBSITE', url: 'https://exemplo.com', imageUrl: IMAGE_URL }],
    ['imageUrl em vídeo', { type: 'VIDEO', url: 'https://youtu.be/x', imageUrl: IMAGE_URL }],
  ])('recusa chave extra: %s', (_nome, item) => {
    expect(trainingTransferItemSchema.safeParse(item).success).toBe(false);
  });

  it.each([
    ['documento', { type: 'DOCUMENT', url: 'https://exemplo.com/a.pdf' }],
    ['texto vazio', { type: 'TEXT', text: '   ' }],
    ['texto longo demais', { type: 'TEXT', text: 'a'.repeat(1029) }],
    ['endereço ftp', { type: 'VIDEO', url: 'ftp://exemplo.com/v' }],
    ['imageUrl ftp', { type: 'TEXT', text: 'x', imageUrl: 'ftp://exemplo.com/i.png' }],
  ])('recusa item inválido: %s', (_nome, item) => {
    expect(trainingTransferItemSchema.safeParse(item).success).toBe(false);
  });

  it('o arquivo exportado é aceito pelo schema do arquivo', () => {
    const file = {
      version: 1,
      exportedAt: '2026-11-16T12:00:00.000Z',
      trainings: [{ type: 'TEXT', text: 'Preços' }],
    };
    expect(trainingExportSchema.safeParse(file).success).toBe(true);
  });
});

describe('envelope da importação', () => {
  it('aceita itens de qualquer forma (cada um é validado à parte)', () => {
    expect(
      trainingImportRequestSchema.safeParse({ version: 1, trainings: [{ lixo: true }, 7, null] })
        .success,
    ).toBe(true);
  });

  it('recusa versão desconhecida ou ausente', () => {
    expect(trainingImportRequestSchema.safeParse({ version: 2, trainings: [] }).success).toBe(
      false,
    );
    expect(trainingImportRequestSchema.safeParse({ trainings: [] }).success).toBe(false);
  });

  it('aceita 100 itens e recusa 101', () => {
    const itens = (n: number) => Array.from({ length: n }, () => ({}));
    expect(
      trainingImportRequestSchema.safeParse({
        version: 1,
        trainings: itens(TRAINING_IMPORT_MAX_ITEMS),
      }).success,
    ).toBe(true);
    expect(
      trainingImportRequestSchema.safeParse({
        version: 1,
        trainings: itens(TRAINING_IMPORT_MAX_ITEMS + 1),
      }).success,
    ).toBe(false);
  });

  it('recusa quando trainings não é lista', () => {
    expect(trainingImportRequestSchema.safeParse({ version: 1, trainings: 'x' }).success).toBe(
      false,
    );
  });
});
