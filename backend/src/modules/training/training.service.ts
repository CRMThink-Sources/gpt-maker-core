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
  type UpdateTrainingInput,
  updateTrainingSchema,
} from '@gptmaker/contracts';
import { and, asc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
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
import { interpretCallback } from './training-callback';
import { listRemoteTrainings, matcherFor, sameUrl, type Training } from './training-remote';

export type { Training };

/** Arquivo recebido no upload (já em memória, dentro do limite de tamanho). */
export interface UploadedDocument {
  originalName: string;
  buffer: Buffer;
}

// Criação, listagem para achar o id e o eventual desfazer, com retentativas do GPTMaker.
const LOCK_TTL_MS = 120_000;
const LOCK_WAIT_MS = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  /**
   * Edita o texto de um treinamento `TEXT` (o GPTMaker só edita esse tipo). O GPTMaker é
   * atualizado antes do registro local; texto igual ao atual não chama nada.
   */
  async updateText(
    tenantId: string,
    agentId: string,
    id: string,
    raw: UpdateTrainingInput,
  ): Promise<TrainingView> {
    const input = updateTrainingSchema.parse(raw);
    const owner = await this.trainableAgent(tenantId, agentId);
    return this.withAgentLock(owner.id, async () => {
      const row = await this.getRow(owner, id);
      if (row.type !== 'TEXT') {
        throw new DomainError(
          'TRAINING_NOT_EDITABLE',
          'Só treinamentos de texto podem ser editados; remova este e crie outro',
          HttpStatus.CONFLICT,
        );
      }
      if (row.content === input.text) return toView(row);

      const remoteId = await this.remoteIdOf(owner, row);
      if (!remoteId) {
        throw new DomainError(
          'TRAINING_NOT_READY',
          'O treinamento ainda está sendo registrado no GPTMaker; tente de novo em instantes',
          HttpStatus.CONFLICT,
        );
      }
      await this.callGptMaker(() =>
        this.gptmaker.updateTextTraining(remoteId, { text: input.text }),
      );
      const [updated] = await this.db
        .update(training)
        .set({ content: input.text, gptmakerTrainingId: remoteId })
        .where(eq(training.id, row.id))
        .returning();
      return toView(updated!);
    });
  }

  /**
   * Remove no GPTMaker e marca o registro local como removido; o documento sai do storage. Já
   * ausente no GPTMaker (ou agente fora de sincronia, sem treinamentos lá) só remove aqui.
   */
  async remove(tenantId: string, agentId: string, id: string): Promise<void> {
    const owner = await this.agents.getById(tenantId, agentId);
    await this.withAgentLock(owner.id, async () => {
      const row = await this.getRow(owner, id);
      if (owner.status !== 'OUT_OF_SYNC') {
        const remoteId = await this.remoteIdOf(owner, row);
        if (remoteId) {
          await this.callGptMaker(async () => {
            try {
              await this.gptmaker.deleteTraining(remoteId);
            } catch (error) {
              if (!(error instanceof GptMakerError && error.kind === 'NOT_FOUND')) throw error;
            }
          });
        }
      }
      await this.db.update(training).set({ deletedAt: new Date() }).where(eq(training.id, row.id));
      if (row.documentKey) await this.discardObject(row.documentKey);
    });
  }

  /** Treinamento não removido do agente (já conferido como do tenant); 404 caso contrário. */
  private async getRow(owner: Agent, id: string): Promise<Training> {
    const [row] = UUID.test(id)
      ? await this.db
          .select()
          .from(training)
          .where(
            and(
              eq(training.id, id),
              eq(training.tenantId, owner.tenantId),
              eq(training.agentId, owner.id),
              isNull(training.deletedAt),
            ),
          )
      : [];
    if (!row) {
      throw new DomainError(
        'TRAINING_NOT_FOUND',
        'Treinamento não encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
    return row;
  }

  /**
   * Id do GPTMaker; se a criação não conseguiu identificá-lo, tenta de novo pelo conteúdo e o
   * grava. `null` se ainda não aparece na listagem do GPTMaker.
   */
  private async remoteIdOf(owner: Agent, row: Training): Promise<string | null> {
    if (row.gptmakerTrainingId) return row.gptmakerTrainingId;
    const found = await this.callGptMaker(() => this.findCreated(owner, row.type, matcherFor(row)));
    if (found) {
      await this.db
        .update(training)
        .set({ gptmakerTrainingId: found })
        .where(eq(training.id, row.id));
    }
    return found;
  }

  /**
   * `callbackUrl` do GPTMaker (spec agent-training): o token identifica o treinamento. Status
   * reconhecido atualiza o registro (`FAILED` guarda o motivo, para o usuário reenviar); corpo
   * não reconhecido só vai para o log. Repetir o callback dá o mesmo resultado.
   */
  async applyCallback(token: string, payload: unknown): Promise<void> {
    const [row] = await this.db
      .select()
      .from(training)
      .where(
        and(eq(training.callbackTokenHash, hashCallbackToken(token)), isNull(training.deletedAt)),
      );
    if (!row) {
      throw new DomainError(
        'TRAINING_CALLBACK_INVALID',
        'Callback de treinamento desconhecido',
        HttpStatus.NOT_FOUND,
      );
    }

    const outcome = interpretCallback(payload);
    // Formato não documentado: o corpo fica no log até ser confirmado em staging (tarefa 10.1).
    this.logger.log(
      { trainingId: row.id, outcome: outcome.status, payload: truncatedJson(payload) },
      'callback de treinamento recebido',
    );

    const patch: Partial<typeof training.$inferInsert> = {};
    if (outcome.status === 'DONE') Object.assign(patch, { status: 'DONE', error: null });
    if (outcome.status === 'FAILED') {
      Object.assign(patch, { status: 'FAILED', error: outcome.error });
    }
    if (!row.gptmakerTrainingId && outcome.gptmakerTrainingId) {
      const [taken] = await this.db
        .select({ id: training.id })
        .from(training)
        .where(
          and(eq(training.gptmakerTrainingId, outcome.gptmakerTrainingId), ne(training.id, row.id)),
        );
      if (!taken) patch.gptmakerTrainingId = outcome.gptmakerTrainingId;
    }
    if (Object.keys(patch).length === 0) return;
    await this.db.update(training).set(patch).where(eq(training.id, row.id));
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

    const fresh = (await listRemoteTrainings(this.gptmaker, owner.gptmakerAgentId, type)).filter(
      (candidate) => !known.has(candidate.id),
    );
    const matched = fresh.filter(matches);
    // Conteúdo repetido (dois textos iguais) dá no mesmo: qualquer um deles serve.
    if (matched.length > 0) return matched[0]!.id;
    return fresh.length === 1 ? fresh[0]!.id : null;
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

/** Corpo do callback para o log, cortado para não inflar a linha. */
function truncatedJson(payload: unknown): string {
  const json = JSON.stringify(payload ?? null) ?? 'null';
  return json.length > 2000 ? `${json.slice(0, 2000)}…` : json;
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
