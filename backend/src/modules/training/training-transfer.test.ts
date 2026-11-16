import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FakeRedis } from '../../../test/support/fake-redis';
import { DomainError } from '../../shared/http/api-exception.filter';
import { ImageCopyError } from './training-image.service';
import {
  exportFileName,
  toTransferItem,
  TrainingTransferService,
} from './training-transfer.service';

const TENANT = 'tenant-1';
const AGENT = 'agent-1';
const IMAGE_URL = 'https://api.exemplo.com/public/training-images/abc';

const text = (value: string, extra: Record<string, unknown> = {}) => ({
  type: 'TEXT',
  text: value,
  ...extra,
});
const site = (url = 'https://exemplo.com') => ({ type: 'WEBSITE', url });
const video = (url = 'https://youtu.be/x') => ({ type: 'VIDEO', url });
const file = (trainings: unknown[], version: unknown = 1) => ({ version, trainings });

function setup() {
  let next = 0;
  const trainings = {
    create: vi.fn(async (_tenantId: string, _agentId: string, _input: unknown) => ({
      id: `t-${++next}`,
    })),
    uploadImage: vi.fn(async (_tenantId: string, _agentId: string, _file: unknown) => ({
      id: 'img-copy',
    })),
  };
  const images = {
    readFromPublicUrl: vi.fn(async (_url: string) => ({
      fileName: 'tabela.png',
      body: Buffer.from('png'),
    })),
    discard: vi.fn(async (_id: string | null | undefined) => undefined),
  };
  const agents = {
    getById: vi.fn(async (tenantId: string, id: string) => {
      if (tenantId !== TENANT || id !== AGENT) {
        throw new DomainError('AGENT_NOT_FOUND', 'Agente não encontrado', HttpStatus.NOT_FOUND);
      }
      return { id: AGENT, name: 'Atendente', status: 'ACTIVE' };
    }),
  };
  const redis = new FakeRedis();
  const service = new TrainingTransferService(
    agents as never,
    trainings as never,
    images as never,
    null as never,
    redis.asRedis(),
  );
  const run = (body: unknown) => service.import(TENANT, AGENT, body);
  return { service, trainings, images, agents, run };
}

const errorOf = (promise: Promise<unknown>) => promise.catch((error: unknown) => error);

describe('importação de treinamentos', () => {
  it('cria todos os itens válidos, na ordem do arquivo, como na criação manual', async () => {
    const { run, trainings } = setup();

    const result = await run(file([text('Preços'), site(), video()]));

    expect(result.summary).toEqual({ created: 3, rejected: 0, failed: 0, withWarnings: 0 });
    expect(result.items.map((item) => [item.position, item.type, item.status])).toEqual([
      [1, 'TEXT', 'CREATED'],
      [2, 'WEBSITE', 'CREATED'],
      [3, 'VIDEO', 'CREATED'],
    ]);
    expect(trainings.create.mock.calls.map((call) => call[2])).toEqual([
      { type: 'TEXT', text: 'Preços' },
      {
        type: 'WEBSITE',
        url: 'https://exemplo.com',
        trainingSubPages: false,
        trainingInterval: 'NEVER',
      },
      { type: 'VIDEO', url: 'https://youtu.be/x' },
    ]);
  });

  it('cria os válidos e lista os inválidos com posição e motivo', async () => {
    const { run, trainings } = setup();

    const result = await run(
      file([text('ok'), text('   '), text('ok 2'), video('ftp://exemplo.com/v'), text('ok 3')]),
    );

    expect(result.summary).toMatchObject({ created: 3, rejected: 2, failed: 0 });
    const refused = result.items.filter((item) => item.status === 'REJECTED');
    expect(refused.map((item) => item.position)).toEqual([2, 4]);
    expect(refused.every((item) => item.reason?.code === 'INVALID_ITEM')).toBe(true);
    expect(refused.every((item) => item.reason?.message)).toBe(true);
    expect(trainings.create).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['managed', text('x', { managed: true })],
    ['imageId', text('x', { imageId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' })],
    ['documento', { type: 'DOCUMENT', url: 'https://exemplo.com/a.pdf' }],
    ['não objeto', 'texto solto'],
  ])('não cria item que tenta passar %s', async (_nome, item) => {
    const { run, trainings } = setup();

    const result = await run(file([item]));

    expect(result.items[0]).toMatchObject({ status: 'REJECTED', trainingId: null });
    expect(trainings.create).not.toHaveBeenCalled();
  });

  it('cria só os primeiros até o limite do plano e recusa os demais sem chamar o create', async () => {
    const { run, trainings } = setup();
    const limit = new DomainError(
      'PLAN_TRAINING_LIMIT',
      'Seu plano permite até 2 treinamentos',
      HttpStatus.UNPROCESSABLE_ENTITY,
      { kind: 'trainings' },
    );
    trainings.create
      .mockResolvedValueOnce({ id: 't-1' })
      .mockResolvedValueOnce({ id: 't-2' })
      .mockRejectedValueOnce(limit);

    const result = await run(
      file([text('1'), text('2'), text('3'), text('4'), text('   '), text('5')]),
    );

    expect(result.summary).toMatchObject({ created: 2, rejected: 4 });
    expect(trainings.create).toHaveBeenCalledTimes(3);
    expect(result.items.slice(2).map((item) => item.reason?.code)).toEqual([
      'PLAN_TRAINING_LIMIT',
      'PLAN_TRAINING_LIMIT',
      'INVALID_ITEM',
      'PLAN_TRAINING_LIMIT',
    ]);
  });

  it('estouro da cota de armazenamento é do item: os próximos continuam sendo criados', async () => {
    const { run, trainings } = setup();
    trainings.create.mockRejectedValueOnce(
      new DomainError('PLAN_TRAINING_LIMIT', 'Cota', HttpStatus.UNPROCESSABLE_ENTITY, {
        kind: 'documentBytes',
      }),
    );

    const result = await run(file([text('1'), text('2'), text('3')]));

    expect(result.items.map((item) => item.status)).toEqual(['REJECTED', 'CREATED', 'CREATED']);
    expect(trainings.create).toHaveBeenCalledTimes(3);
  });

  it('GPTMaker fora do ar: depois de 3 indisponibilidades seguidas o resto vira falho sem chamar', async () => {
    const { run, trainings } = setup();
    trainings.create.mockRejectedValue(
      new DomainError('GPTMAKER_UNAVAILABLE', 'Indisponível', HttpStatus.SERVICE_UNAVAILABLE),
    );

    const result = await run(file([1, 2, 3, 4, 5].map((n) => text(String(n)))));

    expect(trainings.create).toHaveBeenCalledTimes(3);
    expect(result.items.map((item) => item.status)).toEqual(Array(5).fill('FAILED'));
    expect(result.items[4]?.reason?.code).toBe('GPTMAKER_UNAVAILABLE');
  });

  it('uma falha isolada não interrompe a importação (a contagem zera ao criar)', async () => {
    const { run, trainings } = setup();
    const down = () =>
      new DomainError('GPTMAKER_UNAVAILABLE', 'Indisponível', HttpStatus.SERVICE_UNAVAILABLE);
    trainings.create
      .mockRejectedValueOnce(down())
      .mockRejectedValueOnce(down())
      .mockResolvedValueOnce({ id: 'ok' })
      .mockRejectedValueOnce(down())
      .mockRejectedValueOnce(down())
      .mockResolvedValueOnce({ id: 'ok2' });

    const result = await run(file([1, 2, 3, 4, 5, 6].map((n) => text(String(n)))));

    expect(trainings.create).toHaveBeenCalledTimes(6);
    expect(result.summary).toMatchObject({ created: 2, failed: 4 });
  });

  it('recusa site e vídeo pela política de mídia e segue com os textos', async () => {
    const { run, trainings } = setup();
    trainings.create.mockImplementation(async (_t, _a, input) => {
      if ((input as { type: string }).type !== 'TEXT') {
        throw new DomainError(
          'TRAINING_ADVANCED_ONLY',
          'Treinamento por site ou vídeo só no modo avançado do agente',
          HttpStatus.CONFLICT,
        );
      }
      return { id: 'ok' };
    });

    const result = await run(file([text('a'), site(), video(), text('b')]));

    expect(result.items.map((item) => item.status)).toEqual([
      'CREATED',
      'REJECTED',
      'REJECTED',
      'CREATED',
    ]);
    expect(result.items[1]?.reason?.code).toBe('TRAINING_ADVANCED_ONLY');
  });

  it('item que o GPTMaker recusa ou não atende vira falho e os demais seguem', async () => {
    const { run, trainings } = setup();
    trainings.create
      .mockResolvedValueOnce({ id: 't-1' })
      .mockRejectedValueOnce(
        new DomainError('GPTMAKER_UNAVAILABLE', 'Indisponível', HttpStatus.SERVICE_UNAVAILABLE),
      )
      .mockResolvedValueOnce({ id: 't-3' });

    const result = await run(file([text('1'), text('2'), text('3')]));

    expect(result.items.map((item) => item.status)).toEqual(['CREATED', 'FAILED', 'CREATED']);
    expect(result.summary).toMatchObject({ created: 2, failed: 1, rejected: 0 });
  });

  it('erro inesperado vira falho sem expor a mensagem interna', async () => {
    const { run, trainings } = setup();
    trainings.create.mockRejectedValueOnce(new Error('connection string postgres://secreto'));

    const result = await run(file([text('1')]));

    expect(result.items[0]).toMatchObject({ status: 'FAILED' });
    expect(JSON.stringify(result)).not.toContain('secreto');
  });

  describe('imagens', () => {
    it('copia a imagem para o agente e liga a cópia ao treinamento', async () => {
      const { run, trainings, images } = setup();

      const result = await run(file([text('Preços', { imageUrl: IMAGE_URL })]));

      expect(images.readFromPublicUrl).toHaveBeenCalledWith(IMAGE_URL);
      expect(trainings.uploadImage).toHaveBeenCalledWith(TENANT, AGENT, {
        originalname: 'tabela.png',
        buffer: Buffer.from('png'),
      });
      expect(trainings.create.mock.calls[0]?.[2]).toEqual({
        type: 'TEXT',
        text: 'Preços',
        imageId: 'img-copy',
      });
      expect(result.items[0]).toMatchObject({ status: 'CREATED', warnings: [] });
    });

    it('imagem que não pode ser lida: cria o texto sem imagem e avisa', async () => {
      const { run, trainings, images } = setup();
      images.readFromPublicUrl.mockRejectedValueOnce(
        new ImageCopyError('IMAGE_NOT_FOUND', 'A imagem não existe mais'),
      );

      const result = await run(file([text('Preços', { imageUrl: IMAGE_URL })]));

      expect(trainings.uploadImage).not.toHaveBeenCalled();
      expect(trainings.create.mock.calls[0]?.[2]).toEqual({ type: 'TEXT', text: 'Preços' });
      expect(result.items[0]).toMatchObject({
        status: 'CREATED',
        warnings: [{ code: 'IMAGE_NOT_FOUND' }],
      });
      expect(result.summary.withWarnings).toBe(1);
    });

    it.each([
      ['TRAINING_IMAGE_INVALID_TYPE', 'IMAGE_INVALID'],
      ['TRAINING_IMAGE_TOO_LARGE', 'IMAGE_INVALID'],
      ['PLAN_TRAINING_LIMIT', 'IMAGE_QUOTA'],
      ['TRAINING_BUSY', 'IMAGE_FAILED'],
    ])('envio recusado (%s) vira aviso %s e o texto é criado', async (code, warning) => {
      const { run, trainings } = setup();
      trainings.uploadImage.mockRejectedValueOnce(new DomainError(code, 'recusou'));

      const result = await run(file([text('Preços', { imageUrl: IMAGE_URL })]));

      expect(result.items[0]).toMatchObject({
        status: 'CREATED',
        warnings: [{ code: warning }],
      });
      expect(trainings.create.mock.calls[0]?.[2]).toEqual({ type: 'TEXT', text: 'Preços' });
    });

    it('descarta a imagem copiada quando o treinamento não chega a ser criado', async () => {
      const { run, trainings, images } = setup();
      trainings.create.mockRejectedValueOnce(
        new DomainError('GPTMAKER_REJECTED', 'Recusou', HttpStatus.UNPROCESSABLE_ENTITY),
      );

      const result = await run(file([text('Preços', { imageUrl: IMAGE_URL })]));

      expect(result.items[0]?.status).toBe('FAILED');
      expect(images.discard).toHaveBeenCalledWith('img-copy');
    });

    it('não copia imagem de item que nem chega ao create (limite já atingido)', async () => {
      const { run, trainings, images } = setup();
      trainings.create.mockRejectedValueOnce(
        new DomainError('PLAN_TRAINING_LIMIT', 'Limite', HttpStatus.UNPROCESSABLE_ENTITY, {
          kind: 'trainings',
        }),
      );

      await run(file([text('1'), text('2', { imageUrl: IMAGE_URL })]));

      expect(images.readFromPublicUrl).not.toHaveBeenCalled();
    });
  });

  describe('arquivo recusado por inteiro', () => {
    it.each([
      ['versão desconhecida', file([text('a')], 2), 'TRAINING_IMPORT_UNSUPPORTED_VERSION'],
      ['101 itens', file(Array.from({ length: 101 }, () => text('a'))), 'TRAINING_IMPORT_TOO_MANY'],
      ['sem lista', { version: 1, trainings: 'x' }, 'TRAINING_IMPORT_INVALID_FILE'],
      ['texto qualquer', 'não sou json', 'TRAINING_IMPORT_INVALID_FILE'],
      ['nulo', null, 'TRAINING_IMPORT_INVALID_FILE'],
    ])('%s: nada é criado', async (_nome, body, code) => {
      const { run, trainings } = setup();

      const error = await errorOf(run(body));

      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe(code);
      expect(trainings.create).not.toHaveBeenCalled();
    });
  });

  it('agente de outro tenant responde como inexistente, sem criar nada', async () => {
    const { service, trainings } = setup();

    const error = await errorOf(service.import('outro-tenant', AGENT, file([text('a')])));

    expect((error as DomainError).getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(trainings.create).not.toHaveBeenCalled();
  });

  it('agente fora de sincronia com o GPTMaker é recusado antes de qualquer item', async () => {
    const { run, trainings, agents } = setup();
    agents.getById.mockResolvedValueOnce({ id: AGENT, name: 'A', status: 'OUT_OF_SYNC' });

    const error = await errorOf(run(file([text('a')])));

    expect((error as DomainError).code).toBe('AGENT_OUT_OF_SYNC');
    expect(trainings.create).not.toHaveBeenCalled();
  });

  it('duas importações do mesmo tenant não rodam ao mesmo tempo', async () => {
    const { run, trainings } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let active = 0;
    let maxActive = 0;
    trainings.create.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate;
      active -= 1;
      return { id: 'x' };
    });

    const first = run(file([text('a')]));
    const second = run(file([text('b')]));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(trainings.create).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);

    expect(trainings.create).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });
});

describe('item do arquivo de exportação', () => {
  const row = (extra: Record<string, unknown>) => ({ type: 'TEXT', ...extra }) as never;

  it('texto sai só com o conteúdo e, se houver, o link da imagem', () => {
    expect(toTransferItem(row({ content: 'Preços' }))).toEqual({ type: 'TEXT', text: 'Preços' });
    expect(toTransferItem(row({ content: 'Preços' }), IMAGE_URL)).toEqual({
      type: 'TEXT',
      text: 'Preços',
      imageUrl: IMAGE_URL,
    });
  });

  it('site e vídeo saem sem identificadores, com os padrões quando faltam', () => {
    expect(
      toTransferItem(
        row({
          type: 'WEBSITE',
          url: 'https://a.com',
          trainingSubPages: null,
          trainingInterval: null,
        }),
      ),
    ).toEqual({
      type: 'WEBSITE',
      url: 'https://a.com',
      trainingSubPages: false,
      trainingInterval: 'NEVER',
    });
    expect(
      toTransferItem(row({ type: 'VIDEO', url: 'https://youtu.be/x', id: 'interno' })),
    ).toEqual({ type: 'VIDEO', url: 'https://youtu.be/x' });
  });

  it('documento e linha sem conteúdo ficam de fora', () => {
    expect(toTransferItem(row({ type: 'DOCUMENT', documentName: 'a.pdf' }))).toBeNull();
    expect(toTransferItem(row({ content: null }))).toBeNull();
    expect(toTransferItem(row({ type: 'VIDEO', url: null }))).toBeNull();
  });
});

describe('nome do arquivo exportado', () => {
  const now = new Date('2026-11-16T15:00:00.000Z');

  it.each([
    ['Atendente Comercial', 'treinamentos-atendente-comercial-2026-11-16.json'],
    ['Agente São João / SDR #1', 'treinamentos-agente-sao-joao-sdr-1-2026-11-16.json'],
    ['!!!', 'treinamentos-agente-2026-11-16.json'],
    ['../../etc/passwd', 'treinamentos-etc-passwd-2026-11-16.json'],
  ])('%s', (name, expected) => {
    expect(exportFileName(name, now)).toBe(expected);
  });
});
