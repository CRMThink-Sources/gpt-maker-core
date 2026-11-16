import { describe, expect, it } from 'vitest';
import { createT } from '@/i18n';
import {
  checkImportFile,
  exportHasImages,
  importReasonText,
  trainingExportFileName,
} from './trainings';

describe('nome do arquivo de exportação', () => {
  const now = new Date('2026-11-16T15:00:00.000Z');

  it.each([
    ['Atendente Comercial', 'treinamentos-atendente-comercial-2026-11-16.json'],
    ['Agente São João / SDR #1', 'treinamentos-agente-sao-joao-sdr-1-2026-11-16.json'],
    ['!!!', 'treinamentos-agente-2026-11-16.json'],
    ['../../etc/passwd', 'treinamentos-etc-passwd-2026-11-16.json'],
  ])('%s', (name, expected) => {
    expect(trainingExportFileName(name, now)).toBe(expected);
  });
});

describe('leitura do arquivo de importação', () => {
  const file = (trainings: unknown[], version: unknown = 1) =>
    JSON.stringify({ version, exportedAt: '2026-11-16T12:00:00.000Z', trainings });

  it('aceita o arquivo e conta itens e imagens', () => {
    const result = checkImportFile(
      file([
        { type: 'TEXT', text: 'a', imageUrl: 'https://api.exemplo.com/public/training-images/x' },
        { type: 'TEXT', text: 'b' },
        { type: 'VIDEO', url: 'https://youtu.be/x' },
      ]),
    );
    expect(result).toMatchObject({ ok: true, count: 3, withImages: 1 });
  });

  it('não é JSON', () => {
    expect(checkImportFile('isto não é json')).toEqual({ ok: false, reason: 'NOT_JSON' });
  });

  it.each([
    ['sem a lista', JSON.stringify({ version: 1 }), 'INVALID'],
    ['lista que não é lista', JSON.stringify({ version: 1, trainings: 'x' }), 'INVALID'],
    ['texto solto', JSON.stringify('oi'), 'INVALID'],
    ['versão desconhecida', file([], 2), 'VERSION'],
    ['mais de 100 itens', file(Array.from({ length: 101 }, () => ({}))), 'TOO_MANY'],
  ])('recusa: %s', (_nome, text, reason) => {
    expect(checkImportFile(text)).toEqual({ ok: false, reason });
  });

  it('item inválido não derruba o arquivo (o servidor decide item a item)', () => {
    expect(checkImportFile(file([{ lixo: true }, { type: 'TEXT', text: 'ok' }]))).toMatchObject({
      ok: true,
      count: 2,
    });
  });
});

describe('arquivo exportado', () => {
  it('sabe se algum item leva imagem', () => {
    const base = { version: 1 as const, exportedAt: '2026-11-16T12:00:00.000Z' };
    expect(exportHasImages({ ...base, trainings: [{ type: 'TEXT', text: 'a' }] })).toBe(false);
    expect(
      exportHasImages({
        ...base,
        trainings: [{ type: 'TEXT', text: 'a', imageUrl: 'https://x.com/i' }],
      }),
    ).toBe(true);
  });
});

describe('motivo de item da importação', () => {
  const t = createT('pt-BR', 'trainings');

  it('traduz o código conhecido e cai no texto da API nos demais', () => {
    expect(importReasonText({ code: 'PLAN_TRAINING_LIMIT', message: 'x' }, t)).toMatch(/plano/i);
    expect(importReasonText({ code: 'CODIGO_NOVO', message: 'Texto da API' }, t)).toBe(
      'Texto da API',
    );
  });
});
