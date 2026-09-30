import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  createTrainingSchema,
  type CreateTrainingInput,
  TRAINING_DOCUMENT_MAX_BYTES,
  TRAINING_DOCUMENT_TYPES,
  type TrainingInterval,
  type TrainingView,
} from '@gptmaker/contracts';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { currentContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import { training } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { ObjectStorage } from '../../shared/storage/object-storage';
import { type Agent, AgentRepository } from '../agents';
import {
  GptMakerClient,
  GptMakerError,
  type GptMakerCreateTraining,
  type GptMakerTraining,
  type GptMakerTrainingType,
} from '../gptmaker';

export type Training = typeof training.$inferSelect;

/** Arquivo recebido no upload (já em memória, dentro do limite de tamanho). */
export interface UploadedDocument {
  originalName: string;
  buffer: Buffer;
}

// Criação, listagem para achar o id e o eventual desfazer, com retentativas do GPTMaker.
const LOCK_TTL_MS = 120_000;
const LOCK_WAIT_MS = 30_000;
const LIST_PAGE_SIZE = 100;
const LIST_MAX_PAGES = 20;

/**
 * Treinamentos dos agentes do tenant (spec agent-training). O registro local nasce `PROCESSING`
 * antes da chamada ao GPTMaker, para o `callbackUrl` achá-lo mesmo se chegar rápido; se o GPTMaker
 * recusar, o registro e o documento são descartados. Treinamento não debita créditos.
 */
@Injectable()
export class TrainingService {
  private readonly logger = new Logger(TrainingService.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly agents: AgentRepository,
    private readonly gptmaker: GptMakerClient,
    private readonly storage: ObjectStorage,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.lock = new DistributedLock(redis);
  }

  async list(tenantId: string, agentId: string): Promise<TrainingView[]> {
    const owner = await this.agents.getById(tenantId, agentId);
    const rows = await this.db
      .select()
      .from(training)
      .where(
        and(
          eq(training.tenantId, tenantId),
          eq(training.agentId, owner.id),
          isNull(training.deletedAt),
        ),
      )
      .orderBy(asc(training.createdAt), asc(training.id));
    return rows.map(toView);
  }

  /** Texto, site ou vídeo. */
  async create(tenantId: string, agentId: string, raw: CreateTrainingInput): Promise<TrainingView> {
    const input = createTrainingSchema.parse(raw);
    const owner = await this.trainableAgent(tenantId, agentId);
    const callback = this.newCallback();

    switch (input.type) {
      case 'TEXT':
        return this.createRemoteAndLocal(
          owner,
          { type: 'TEXT', content: input.text, callbackTokenHash: callback.hash },
          { type: 'TEXT', text: input.text, callbackUrl: callback.url },
          (remote) => remote.text?.trim() === input.text,
        );
      case 'WEBSITE':
        return this.createRemoteAndLocal(
          owner,
          {
            type: 'WEBSITE',
            url: input.url,
            trainingSubPages: input.trainingSubPages,
            trainingInterval: input.trainingInterval,
            callbackTokenHash: callback.hash,
          },
          {
            type: 'WEBSITE',
            website: input.url,
            trainingSubPages: input.trainingSubPages ? 'ACTIVE' : 'DISABLED',
            trainingInterval: input.trainingInterval,
            callbackUrl: callback.url,
          },
          (remote) => sameUrl(remote.website, input.url),
        );
      case 'VIDEO':
        return this.createRemoteAndLocal(
          owner,
          { type: 'VIDEO', url: input.url, callbackTokenHash: callback.hash },
          { type: 'VIDEO', video: input.url, callbackUrl: callback.url },
          (remote) => sameUrl(remote.video, input.url),
        );
    }
  }

  /**
   * Documento: valida tipo e conteúdo, grava no storage com chave aleatória e entrega ao
   * GPTMaker a URL pré-assinada. Recusado antes de qualquer chamada externa se inválido.
   */
  async createDocument(
    tenantId: string,
    agentId: string,
    file: UploadedDocument,
  ): Promise<TrainingView> {
    const owner = await this.trainableAgent(tenantId, agentId);
    const name = documentName(file.originalName);
    const mimetype = validateDocument(name, file.buffer);
    const key = this.storage.newTrainingKey(tenantId, name);
    await this.storage.put({
      key,
      body: file.buffer,
      contentType: mimetype,
      contentLength: file.buffer.length,
      fileName: name,
    });

    try {
      const url = await this.storage.presignedUrl(key);
      const callback = this.newCallback();
      return await this.createRemoteAndLocal(
        owner,
        {
          type: 'DOCUMENT',
          documentKey: key,
          documentName: name,
          documentMimetype: mimetype,
          documentSizeBytes: file.buffer.length,
          callbackTokenHash: callback.hash,
        },
        {
          type: 'DOCUMENT',
          documentUrl: url,
          documentName: name,
          documentMimetype: mimetype,
          callbackUrl: callback.url,
        },
        (remote) => remote.documentUrl === url || remote.documentName === name,
      );
    } catch (error) {
      await this.discardObject(key);
      throw error;
    }
  }

  /** Agente do tenant (404 se de outro) e sincronizado com o GPTMaker. */
  private async trainableAgent(tenantId: string, agentId: string): Promise<Agent> {
    const owner = await this.agents.getById(tenantId, agentId);
    if (owner.status === 'OUT_OF_SYNC') {
      throw new DomainError(
        'AGENT_OUT_OF_SYNC',
        'O agente não foi encontrado no GPTMaker; fale com o suporte',
        HttpStatus.CONFLICT,
      );
    }
    return owner;
  }

  /**
   * O GPTMaker não devolve o id do treinamento criado: depois de criar, lista os do tipo e fica
   * com o novo (id ainda sem registro local) que casa com o conteúdo. Criações do mesmo agente são
   * serializadas para essa busca não confundir dois treinamentos novos. Sem id, o registro segue
   * `PROCESSING` e a sincronização com o GPTMaker o completa.
   */
  private async createRemoteAndLocal(
    owner: Agent,
    local: Omit<typeof training.$inferInsert, 'tenantId' | 'agentId'>,
    remote: GptMakerCreateTraining,
    matches: (candidate: GptMakerTraining) => boolean,
  ): Promise<TrainingView> {
    return this.withAgentLock(owner.id, async () => {
      const [row] = await this.db
        .insert(training)
        .values({ ...local, tenantId: owner.tenantId, agentId: owner.id, status: 'PROCESSING' })
        .returning();

      try {
        await this.callGptMaker(() => this.gptmaker.createTraining(owner.gptmakerAgentId, remote));
      } catch (error) {
        await this.db.delete(training).where(eq(training.id, row!.id));
        throw error;
      }

      let gptmakerTrainingId: string | null = null;
      try {
        gptmakerTrainingId = await this.findCreated(owner, remote.type, matches);
      } catch (error) {
        this.logger.warn(
          { trainingId: row!.id, err: error },
          'treinamento criado no GPTMaker sem id local; a sincronização completa',
        );
      }
      if (!gptmakerTrainingId) return toView(row!);

      const [updated] = await this.db
        .update(training)
        .set({ gptmakerTrainingId })
        .where(eq(training.id, row!.id))
        .returning();
      return toView(updated!);
    });
  }

  private async findCreated(
    owner: Agent,
    type: GptMakerTrainingType,
    matches: (candidate: GptMakerTraining) => boolean,
  ): Promise<string | null> {
    const knownRows = await this.db
      .select({ id: training.gptmakerTrainingId })
      .from(training)
      .where(and(eq(training.agentId, owner.id), isNotNull(training.gptmakerTrainingId)));
    const known = new Set(knownRows.map((entry) => entry.id));

    const fresh = (await this.listRemote(owner.gptmakerAgentId, type)).filter(
      (candidate) => !known.has(candidate.id),
    );
    const matched = fresh.filter(matches);
    // Conteúdo repetido (dois textos iguais) dá no mesmo: qualquer um deles serve.
    if (matched.length > 0) return matched[0]!.id;
    return fresh.length === 1 ? fresh[0]!.id : null;
  }

  private async listRemote(
    gptmakerAgentId: string,
    type: GptMakerTrainingType,
  ): Promise<GptMakerTraining[]> {
    const all: GptMakerTraining[] = [];
    // Base da paginação não documentada: começa em 1 e para na primeira página incompleta.
    for (let page = 1; page <= LIST_MAX_PAGES; page++) {
      const batch = await this.gptmaker.listTrainings(gptmakerAgentId, type, {
        page,
        pageSize: LIST_PAGE_SIZE,
      });
      all.push(...batch);
      if (batch.length < LIST_PAGE_SIZE) break;
    }
    return all;
  }

  /** Espera a vez em vez de recusar: vários uploads seguidos do mesmo agente são comuns. */
  private async withAgentLock<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      const outcome = await this.lock.runExclusive(`training:${agentId}`, LOCK_TTL_MS, fn);
      if (outcome.ran) return outcome.result;
      if (Date.now() > deadline) {
        throw new DomainError(
          'TRAINING_BUSY',
          'Outro treinamento deste agente está sendo enviado; tente de novo em instantes',
          HttpStatus.CONFLICT,
        );
      }
      await sleep(250);
    }
  }

  /** Token só no `callbackUrl` do GPTMaker; aqui fica o hash (endpoint na tarefa 8.3). */
  private newCallback(): { url: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return {
      url: `${this.env.API_PUBLIC_URL}/gptmaker/trainings/callback?t=${encodeURIComponent(token)}`,
      hash: hashCallbackToken(token),
    };
  }

  private async discardObject(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.error({ key, err: error }, 'documento ficou órfão no storage');
    }
  }

  /** Falha do GPTMaker vira erro recuperável com o `traceId` para o suporte localizar o log. */
  private async callGptMaker<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof GptMakerError)) throw error;
      const traceId = currentContext()?.traceId;
      this.logger.error(
        { traceId, operation: error.operation, kind: error.kind, err: error },
        'falha no GPTMaker',
      );
      if (error.kind === 'VALIDATION') {
        throw new DomainError(
          'GPTMAKER_REJECTED',
          'O GPTMaker recusou o treinamento. Revise o conteúdo e tente de novo',
          HttpStatus.UNPROCESSABLE_ENTITY,
          { traceId, reason: error.message },
        );
      }
      throw new DomainError(
        'GPTMAKER_UNAVAILABLE',
        'Não foi possível enviar o treinamento ao GPTMaker agora. Tente de novo em instantes',
        HttpStatus.SERVICE_UNAVAILABLE,
        { traceId },
      );
    }
  }
}

export function hashCallbackToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function sameUrl(a: string | null | undefined, b: string): boolean {
  const normalize = (value: string) => value.trim().replace(/\/+$/, '').toLowerCase();
  return a !== null && a !== undefined && normalize(a) === normalize(b);
}

/** Nome sem caminho e sem caracteres de controle; o multer entrega em latin1. */
function documentName(original: string): string {
  const utf8 = Buffer.from(original, 'latin1').toString('utf8');
  const name = (utf8.includes('�') ? original : utf8)
    .split(/[\\/]/)
    .pop()!
    // eslint-disable-next-line no-control-regex -- remove justamente os caracteres de controle
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 200);
  return name || 'documento';
}

const MAGIC: Partial<Record<keyof typeof TRAINING_DOCUMENT_TYPES, number[]>> = {
  pdf: [0x25, 0x50, 0x44, 0x46], // %PDF
  docx: [0x50, 0x4b, 0x03, 0x04], // zip
  xlsx: [0x50, 0x4b, 0x03, 0x04],
  pptx: [0x50, 0x4b, 0x03, 0x04],
  doc: [0xd0, 0xcf, 0x11, 0xe0], // OLE
};

/**
 * Tipo pela extensão, conferido pelo início do arquivo (o MIME enviado pelo navegador não é
 * confiável). Textos precisam ser UTF-8 sem bytes nulos.
 */
function validateDocument(name: string, buffer: Buffer): string {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() as
    keyof typeof TRAINING_DOCUMENT_TYPES | undefined;
  const mimetype = extension ? TRAINING_DOCUMENT_TYPES[extension] : undefined;
  if (!extension || !mimetype) {
    throw new DomainError(
      'TRAINING_FILE_TYPE',
      `Formato não aceito. Envie ${Object.keys(TRAINING_DOCUMENT_TYPES).join(', ')}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      { accepted: Object.keys(TRAINING_DOCUMENT_TYPES) },
    );
  }
  if (buffer.length === 0) {
    throw new DomainError('TRAINING_FILE_EMPTY', 'O arquivo está vazio');
  }
  if (buffer.length > TRAINING_DOCUMENT_MAX_BYTES) throw fileTooLarge();

  const magic = MAGIC[extension];
  const textual = mimetype.startsWith('text/');
  const valid = magic
    ? magic.every((byte, index) => buffer[index] === byte)
    : textual && !buffer.includes(0) && !buffer.toString('utf8').includes('�');
  if (!valid) {
    throw new DomainError(
      'TRAINING_FILE_TYPE',
      'O conteúdo do arquivo não corresponde à extensão. Confira se o arquivo não está corrompido',
    );
  }
  return mimetype;
}

export const fileTooLarge = () =>
  new DomainError(
    'TRAINING_FILE_TOO_LARGE',
    `O arquivo passa do limite de ${TRAINING_DOCUMENT_MAX_BYTES / 1024 / 1024} MB`,
    HttpStatus.PAYLOAD_TOO_LARGE,
    { maxBytes: TRAINING_DOCUMENT_MAX_BYTES },
  );

function toView(row: Training): TrainingView {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    text: row.content,
    url: row.url,
    trainingSubPages: row.trainingSubPages,
    trainingInterval: row.trainingInterval as TrainingInterval | null,
    document:
      row.type === 'DOCUMENT'
        ? {
            name: row.documentName ?? 'documento',
            mimetype: row.documentMimetype ?? 'application/octet-stream',
            sizeBytes: row.documentSizeBytes ?? 0,
          }
        : null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
