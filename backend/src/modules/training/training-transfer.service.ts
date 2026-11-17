import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CreateTrainingInput,
  TRAINING_IMPORT_MAX_ITEMS,
  type TrainingExport,
  type TrainingImportItemResult,
  type TrainingImportReason,
  type TrainingImportResult,
  type TrainingInterval,
  type TrainingTransferItem,
  trainingImportRequestSchema,
  trainingTransferItemSchema,
} from '@gptmaker/contracts';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type Redis from 'ioredis';
import { enrichContext } from '../../shared/context/request-context';
import { DB, type Database } from '../../shared/database/database.module';
import { training } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { AgentRepository } from '../agents';
import { ImageCopyError, TrainingImageService } from './training-image.service';
import { TrainingService } from './training.service';

type Row = typeof training.$inferSelect;

// A importação inteira roda sob um lock por tenant (design D4): até 100 itens com chamadas ao GPTMaker.
const IMPORT_LOCK_TTL_MS = 15 * 60_000;
const IMPORT_LOCK_WAIT_MS = 30_000;
const LIMIT_CODE = 'PLAN_TRAINING_LIMIT';
// GPTMaker fora do ar: cada item esperaria o timeout do cliente e o lock poderia expirar no meio.
// Depois de tantas indisponibilidades seguidas, os demais itens válidos só são marcados como falhos.
const MAX_CONSECUTIVE_UNAVAILABLE = 3;

interface ImportState {
  limit: TrainingImportReason | null;
  unavailable: number;
  unavailableReason: TrainingImportReason | null;
}

/**
 * Exportar e importar os treinamentos manuais de um agente (spec agent-training-transfer). A
 * importação não reimplementa regra: cada item passa por `TrainingService.create` (limite do plano,
 * política de mídia, GPTMaker, desfazer do registro local).
 */
@Injectable()
export class TrainingTransferService {
  private readonly logger = new Logger(TrainingTransferService.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly agents: AgentRepository,
    private readonly trainings: TrainingService,
    private readonly images: TrainingImageService,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) redis: Redis,
  ) {
    this.lock = new DistributedLock(redis);
  }

  /** Treinamentos manuais (texto, site, vídeo) do agente, na ordem de criação, sem identificadores. */
  async export(
    tenantId: string,
    agentId: string,
    now = new Date(),
  ): Promise<{ file: TrainingExport; fileName: string }> {
    const owner = await this.agents.getById(tenantId, agentId);
    const rows = await this.db
      .select()
      .from(training)
      .where(
        and(
          eq(training.tenantId, tenantId),
          eq(training.agentId, owner.id),
          eq(training.managed, false),
          inArray(training.type, ['TEXT', 'WEBSITE', 'VIDEO']),
          isNull(training.deletedAt),
          // Expirado já não existe no GPTMaker; exportá-lo recriaria conteúdo vencido (spec).
          ne(training.status, 'EXPIRED'),
        ),
      )
      .orderBy(asc(training.createdAt), asc(training.id));
    const images = await this.images.findMany(
      rows.flatMap((row) => (row.imageId ? [row.imageId] : [])),
    );
    const trainings: TrainingTransferItem[] = [];
    for (const row of rows) {
      const image = row.imageId ? images.get(row.imageId) : undefined;
      const item = toTransferItem(row, image ? await this.images.imageUrlFor(image) : undefined);
      if (item) trainings.push(item);
    }
    return {
      file: { version: 1, exportedAt: now.toISOString(), trainings },
      fileName: exportFileName(owner.name, now),
    };
  }

  /** Cria os itens do arquivo no agente; item a item, com relatório (design D3). */
  async import(tenantId: string, agentId: string, body: unknown): Promise<TrainingImportResult> {
    const owner = await this.agents.getById(tenantId, agentId);
    if (owner.status === 'OUT_OF_SYNC') {
      throw new DomainError(
        'AGENT_OUT_OF_SYNC',
        'O agente não foi encontrado no GPTMaker; fale com o suporte',
        HttpStatus.CONFLICT,
      );
    }
    const envelope = parseEnvelope(body);
    enrichContext({ tenantId, agentId: owner.id });

    const outcome = await this.lock.runExclusiveWaiting(
      `training-import:${tenantId}`,
      IMPORT_LOCK_TTL_MS,
      IMPORT_LOCK_WAIT_MS,
      () => this.importItems(tenantId, owner.id, envelope),
    );
    if (!outcome.ran) {
      throw new DomainError(
        'TRAINING_IMPORT_BUSY',
        'Outra importação deste tenant está em andamento; tente de novo em instantes',
        HttpStatus.CONFLICT,
      );
    }
    // Só contagens: o conteúdo do arquivo (textos, endereços) nunca vai para o log.
    this.logger.log(
      { tenantId, agentId: owner.id, ...outcome.result.summary },
      'importação de treinamentos',
    );
    return outcome.result;
  }

  private async importItems(
    tenantId: string,
    agentId: string,
    envelope: unknown[],
  ): Promise<TrainingImportResult> {
    const items: TrainingImportItemResult[] = [];
    // Depois do primeiro `PLAN_TRAINING_LIMIT` o limite não volta a sobrar: os demais válidos só
    // são recusados, sem chamar o `create` (spec: os primeiros entram, na ordem do arquivo).
    const state: ImportState = { limit: null, unavailable: 0, unavailableReason: null };

    for (const [index, raw] of envelope.entries()) {
      const position = index + 1;
      const parsed = trainingTransferItemSchema.safeParse(raw);
      if (!parsed.success) {
        items.push(
          rejected(position, typeOf(raw), {
            code: 'INVALID_ITEM',
            message: describe(parsed.error),
          }),
        );
        continue;
      }
      if (state.limit) {
        items.push(rejected(position, parsed.data.type, state.limit));
        continue;
      }
      if (state.unavailable >= MAX_CONSECUTIVE_UNAVAILABLE && state.unavailableReason) {
        items.push(failed(position, parsed.data.type, state.unavailableReason));
        continue;
      }
      items.push(await this.importOne(tenantId, agentId, position, parsed.data, state));
    }

    return { summary: summarize(items), items };
  }

  private async importOne(
    tenantId: string,
    agentId: string,
    position: number,
    item: TrainingTransferItem,
    state: ImportState,
  ): Promise<TrainingImportItemResult> {
    const warnings: TrainingImportReason[] = [];
    let imageId: string | undefined;
    if (item.type === 'TEXT' && item.imageUrl) {
      const copy = await this.copyImage(tenantId, agentId, item.imageUrl);
      if ('warning' in copy) warnings.push(copy.warning);
      else imageId = copy.imageId;
    }

    try {
      const created = await this.trainings.create(tenantId, agentId, toCreateInput(item, imageId));
      state.unavailable = 0;
      return {
        position,
        type: item.type,
        status: 'CREATED',
        trainingId: created.id,
        reason: null,
        warnings,
      };
    } catch (error) {
      // A imagem copiada só existe para este treinamento: sem ele, ficaria órfã (design D5b).
      await this.images.discard(imageId);
      if (error instanceof DomainError) {
        const reason = { code: error.code, message: error.message };
        // Só o limite de quantidade encerra a importação; o de armazenamento (`kind` diferente) é
        // do item (a imagem), não dos próximos.
        if (
          error.code === LIMIT_CODE &&
          (error.details as { kind?: string } | undefined)?.kind === 'trainings'
        ) {
          state.limit = reason;
        }
        if (error.code === 'GPTMAKER_UNAVAILABLE') {
          state.unavailable += 1;
          state.unavailableReason = reason;
        } else {
          state.unavailable = 0;
        }
        const remote = error.code === 'GPTMAKER_UNAVAILABLE' || error.code === 'GPTMAKER_REJECTED';
        return remote ? failed(position, item.type, reason) : rejected(position, item.type, reason);
      }
      this.logger.error({ tenantId, agentId, position, err: error }, 'item da importação falhou');
      return failed(position, item.type, {
        code: 'IMPORT_ITEM_FAILED',
        message: 'Não foi possível criar este treinamento agora',
      });
    }
  }

  /** Copia a imagem para o agente (mesmas regras do envio); falha vira aviso, nunca erro do item. */
  private async copyImage(
    tenantId: string,
    agentId: string,
    url: string,
  ): Promise<{ imageId: string } | { warning: TrainingImportReason }> {
    try {
      const { fileName, body } = await this.images.readFromPublicUrl(url);
      const uploaded = await this.trainings.uploadImage(tenantId, agentId, {
        originalname: fileName,
        buffer: body,
      });
      return { imageId: uploaded.id };
    } catch (error) {
      if (error instanceof ImageCopyError) {
        return { warning: { code: error.code, message: error.message } };
      }
      if (error instanceof DomainError) {
        return { warning: { code: imageCodeOf(error), message: error.message } };
      }
      this.logger.error({ tenantId, agentId, err: error }, 'cópia da imagem importada falhou');
      return {
        warning: { code: 'IMAGE_FAILED', message: 'Não foi possível importar a imagem' },
      };
    }
  }
}

/** Item do arquivo para a criação manual (`imageId` é a cópia feita aqui, nunca vem do arquivo). */
function toCreateInput(
  item: TrainingTransferItem,
  imageId: string | undefined,
): CreateTrainingInput {
  const tags = item.tags?.length ? { tags: item.tags } : {};
  switch (item.type) {
    case 'TEXT':
      return { type: 'TEXT', text: item.text, ...(imageId && { imageId }), ...tags };
    case 'WEBSITE':
      return {
        type: 'WEBSITE',
        url: item.url,
        trainingSubPages: item.trainingSubPages,
        trainingInterval: item.trainingInterval,
        ...tags,
      };
    case 'VIDEO':
      return { type: 'VIDEO', url: item.url, ...tags };
  }
}

/** Linha do banco para o item do arquivo; `null` se faltar o conteúdo (não seria importável). */
export function toTransferItem(row: Row, imageUrl?: string): TrainingTransferItem | null {
  // Tags saem só quando existem; a expiração nunca vai no arquivo (ficaria vencida ao reimportar).
  const tags = row.tags?.length ? { tags: row.tags } : {};
  switch (row.type) {
    case 'TEXT':
      return row.content
        ? { type: 'TEXT', text: row.content, ...(imageUrl && { imageUrl }), ...tags }
        : null;
    case 'WEBSITE':
      return row.url
        ? {
            type: 'WEBSITE',
            url: row.url,
            trainingSubPages: row.trainingSubPages ?? false,
            trainingInterval: (row.trainingInterval as TrainingInterval | null) ?? 'NEVER',
            ...tags,
          }
        : null;
    case 'VIDEO':
      return row.url ? { type: 'VIDEO', url: row.url, ...tags } : null;
    case 'DOCUMENT':
      return null;
  }
}

/** `treinamentos-<nome-do-agente>-AAAA-MM-DD.json`, só com letras, números e hífen. */
export function exportFileName(agentName: string, now: Date): string {
  const slug =
    agentName
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '') || 'agente';
  return `treinamentos-${slug}-${now.toISOString().slice(0, 10)}.json`;
}

/** Recusa o arquivo inteiro: versão desconhecida, estrutura inválida ou itens demais. */
function parseEnvelope(body: unknown): unknown[] {
  const parsed = trainingImportRequestSchema.safeParse(body);
  if (parsed.success) return parsed.data.trainings;
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  if ('version' in record && record['version'] !== 1) {
    throw new DomainError(
      'TRAINING_IMPORT_UNSUPPORTED_VERSION',
      'A versão deste arquivo não é suportada; exporte os treinamentos de novo',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (
    Array.isArray(record['trainings']) &&
    record['trainings'].length > TRAINING_IMPORT_MAX_ITEMS
  ) {
    throw new DomainError(
      'TRAINING_IMPORT_TOO_MANY',
      `O arquivo passa do limite de ${TRAINING_IMPORT_MAX_ITEMS} treinamentos por importação`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  throw new DomainError(
    'TRAINING_IMPORT_INVALID_FILE',
    'O arquivo não é uma exportação de treinamentos válida',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

function typeOf(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const type = (raw as Record<string, unknown>)['type'];
  return typeof type === 'string' ? type.slice(0, 20) : null;
}

/** Motivo curto do primeiro problema do item, sem repetir o conteúdo enviado. */
function describe(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  const issue = error.issues[0];
  if (!issue) return 'Item inválido';
  const field = issue.path.map(String).join('.');
  return field ? `${field}: ${issue.message}` : issue.message;
}

function imageCodeOf(error: DomainError): 'IMAGE_INVALID' | 'IMAGE_QUOTA' | 'IMAGE_FAILED' {
  if (error.code === LIMIT_CODE) return 'IMAGE_QUOTA';
  if (error.code.startsWith('TRAINING_IMAGE_')) return 'IMAGE_INVALID';
  return 'IMAGE_FAILED';
}

const rejected = (
  position: number,
  type: string | null,
  reason: TrainingImportReason,
): TrainingImportItemResult => ({
  position,
  type,
  status: 'REJECTED',
  trainingId: null,
  reason,
  warnings: [],
});

const failed = (
  position: number,
  type: string | null,
  reason: TrainingImportReason,
): TrainingImportItemResult => ({ ...rejected(position, type, reason), status: 'FAILED' });

function summarize(items: TrainingImportItemResult[]): TrainingImportResult['summary'] {
  return {
    created: items.filter((item) => item.status === 'CREATED').length,
    rejected: items.filter((item) => item.status === 'REJECTED').length,
    failed: items.filter((item) => item.status === 'FAILED').length,
    withWarnings: items.filter((item) => item.warnings.length > 0).length,
  };
}
