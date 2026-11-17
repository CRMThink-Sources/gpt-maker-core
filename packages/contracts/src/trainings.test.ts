import { describe, expect, it } from 'vitest';
import {
  createTrainingSchema,
  listTrainingsQuerySchema,
  TRAINING_IMPORT_MAX_ITEMS,
  trainingExportSchema,
  trainingImportRequestSchema,
  trainingTagsSchema,
  trainingTransferItemSchema,
  updateTrainingSettingsSchema,
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

describe('tags de treinamento', () => {
  it('normaliza caixa, espaços e duplicatas', () => {
    expect(trainingTagsSchema.parse(['Preços', 'preços ', 'PREÇOS', '  novo   plano '])).toEqual([
      'preços',
      'novo plano',
    ]);
  });

  it('descarta tags vazias', () => {
    expect(trainingTagsSchema.parse(['', '   ', 'a'])).toEqual(['a']);
  });

  it('aceita 10 tags e recusa 11', () => {
    const tags = (n: number) => Array.from({ length: n }, (_, i) => `tag${i}`);
    expect(trainingTagsSchema.safeParse(tags(10)).success).toBe(true);
    expect(trainingTagsSchema.safeParse(tags(11)).success).toBe(false);
  });

  it('aceita tag de 30 caracteres e recusa 31', () => {
    expect(trainingTagsSchema.safeParse(['a'.repeat(30)]).success).toBe(true);
    expect(trainingTagsSchema.safeParse(['a'.repeat(31)]).success).toBe(false);
  });
});

describe('criação com tags e expiração', () => {
  const future = () => new Date(Date.now() + 86_400_000).toISOString();

  it.each([
    ['texto', { type: 'TEXT', text: 'x' }],
    ['site', { type: 'WEBSITE', url: 'https://exemplo.com' }],
    ['vídeo', { type: 'VIDEO', url: 'https://youtu.be/x' }],
  ])('%s aceita tags e expiração futura', (_nome, base) => {
    const parsed = createTrainingSchema.parse({ ...base, tags: ['A', 'a'], expiresAt: future() });
    expect(parsed).toMatchObject({ tags: ['a'] });
  });

  it('recusa expiração no passado', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(
      createTrainingSchema.safeParse({ type: 'TEXT', text: 'x', expiresAt: past }).success,
    ).toBe(false);
  });
});

describe('ajustes do treinamento (tags e expiração)', () => {
  it('aceita só tags, só expiração ou expiração nula para limpar', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(updateTrainingSettingsSchema.safeParse({ tags: ['a'] }).success).toBe(true);
    expect(updateTrainingSettingsSchema.safeParse({ expiresAt: future }).success).toBe(true);
    expect(updateTrainingSettingsSchema.parse({ expiresAt: null })).toEqual({ expiresAt: null });
  });

  it('recusa objeto vazio e campos desconhecidos', () => {
    expect(updateTrainingSettingsSchema.safeParse({}).success).toBe(false);
    expect(updateTrainingSettingsSchema.safeParse({ tags: ['a'], text: 'x' }).success).toBe(false);
  });
});

describe('query da listagem de treinamentos', () => {
  it('usa os padrões', () => {
    expect(listTrainingsQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      type: [],
      status: [],
      tags: [],
    });
  });

  it('lê listas separadas por vírgula e normaliza tags', () => {
    expect(
      listTrainingsQuerySchema.parse({
        page: '2',
        type: 'TEXT,WEBSITE',
        status: 'EXPIRED',
        tags: 'Preços, preços,horários',
        q: ' garantia ',
      }),
    ).toMatchObject({
      page: 2,
      type: ['TEXT', 'WEBSITE'],
      status: ['EXPIRED'],
      tags: ['preços', 'horários'],
      q: 'garantia',
    });
  });

  it.each([
    ['pageSize acima do máximo', { pageSize: '500' }],
    ['página zero', { page: '0' }],
    ['tipo desconhecido', { type: 'AUDIO' }],
    ['estado desconhecido', { status: 'X' }],
  ])('recusa %s', (_nome, query) => {
    expect(listTrainingsQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('item de transferência com tags', () => {
  it('aceita tags e normaliza', () => {
    expect(
      trainingTransferItemSchema.parse({ type: 'TEXT', text: 'x', tags: ['Preços', 'preços'] }),
    ).toMatchObject({ tags: ['preços'] });
  });

  it('arquivo antigo, sem tags, continua válido', () => {
    expect(
      trainingTransferItemSchema.safeParse({ type: 'VIDEO', url: 'https://youtu.be/x' }).success,
    ).toBe(true);
  });

  it('recusa expiresAt no item', () => {
    expect(
      trainingTransferItemSchema.safeParse({
        type: 'TEXT',
        text: 'x',
        expiresAt: '2030-01-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
