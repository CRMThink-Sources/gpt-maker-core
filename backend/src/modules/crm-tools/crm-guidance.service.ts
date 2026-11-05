import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CRM_GUIDANCE_KEYS,
  type CrmGuidanceKey,
  type CrmGuidanceView,
  crmGuidanceKeySchema,
} from '@gptmaker/contracts';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DB, type Database } from '../../shared/database/database.module';
import { backofficeUser, crmToolGuidance } from '../../shared/database/schema/index';
import { REDIS } from '../../shared/redis/redis.module';
import { CRM_GUIDANCE_DEFAULTS, type CrmGuidance } from './crm-guidance.defaults';

/** Validade das edições no Redis: limita o atraso se o `del` ao salvar falhar. */
export const CRM_GUIDANCE_CACHE_TTL_SECONDS = 60;
export const CRM_GUIDANCE_CACHE_KEY = 'crm:guidance';

/** Antes e depois de uma edição, para a auditoria (null: valia o padrão). */
export interface CrmGuidanceChange {
  before: string | null;
  after: string | null;
}

/**
 * Orientações das ferramentas do CRM (spec agent-crm-tools, design 1 e 3): o padrão fica no
 * código e o banco guarda só a edição. A leitura das ferramentas passa por um cache Redis curto;
 * banco ou Redis fora devolvem o padrão, sem derrubar a chamada.
 */
@Injectable()
export class CrmGuidanceService {
  private readonly logger = new Logger(CrmGuidanceService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Textos em uso, para montar as respostas das ferramentas. */
  async current(): Promise<CrmGuidance> {
    let edits: Partial<CrmGuidance> | null = null;
    try {
      const cached = await this.redis.get(CRM_GUIDANCE_CACHE_KEY);
      if (cached !== null) edits = JSON.parse(cached) as Partial<CrmGuidance>;
    } catch (error) {
      this.logger.warn({ err: error }, 'orientações do CRM indisponíveis no Redis; lendo do banco');
    }

    if (!edits) {
      try {
        const rows = await this.db
          .select({ key: crmToolGuidance.key, text: crmToolGuidance.text })
          .from(crmToolGuidance);
        edits = Object.fromEntries(
          rows.filter((row) => isKey(row.key)).map((row) => [row.key, row.text]),
        );
      } catch (error) {
        this.logger.warn({ err: error }, 'orientações do CRM indisponíveis; usando o padrão');
        return { ...CRM_GUIDANCE_DEFAULTS };
      }
      try {
        await this.redis.set(
          CRM_GUIDANCE_CACHE_KEY,
          JSON.stringify(edits),
          'EX',
          CRM_GUIDANCE_CACHE_TTL_SECONDS,
        );
      } catch {
        // Redis fora: a próxima leitura vai ao banco de novo.
      }
    }
    return { ...CRM_GUIDANCE_DEFAULTS, ...edits };
  }

  /** Visão do backoffice: texto em uso, padrão e quem editou. */
  async list(): Promise<CrmGuidanceView[]> {
    const rows = await this.db
      .select({
        key: crmToolGuidance.key,
        text: crmToolGuidance.text,
        updatedAt: crmToolGuidance.updatedAt,
        updatedBy: backofficeUser.name,
      })
      .from(crmToolGuidance)
      .leftJoin(backofficeUser, eq(backofficeUser.id, crmToolGuidance.updatedBy));
    return CRM_GUIDANCE_KEYS.map((key) => {
      const row = rows.find((item) => item.key === key);
      return {
        key,
        text: row?.text ?? CRM_GUIDANCE_DEFAULTS[key],
        defaultText: CRM_GUIDANCE_DEFAULTS[key],
        edited: row !== undefined,
        updatedBy: row?.updatedBy ?? null,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  }

  async save(key: string, text: string, operatorId: string): Promise<CrmGuidanceChange> {
    const valid = assertKey(key);
    const before = await this.edited(valid);
    await this.db
      .insert(crmToolGuidance)
      .values({ key: valid, text, updatedBy: operatorId })
      .onConflictDoUpdate({
        target: crmToolGuidance.key,
        set: { text, updatedBy: operatorId, updatedAt: new Date() },
      });
    await this.invalidate();
    return { before, after: text };
  }

  /** Restaurar o padrão: apaga a edição. */
  async reset(key: string): Promise<CrmGuidanceChange> {
    const valid = assertKey(key);
    const before = await this.edited(valid);
    await this.db.delete(crmToolGuidance).where(eq(crmToolGuidance.key, valid));
    await this.invalidate();
    return { before, after: null };
  }

  private async edited(key: CrmGuidanceKey): Promise<string | null> {
    const [row] = await this.db
      .select({ text: crmToolGuidance.text })
      .from(crmToolGuidance)
      .where(eq(crmToolGuidance.key, key));
    return row?.text ?? null;
  }

  private async invalidate(): Promise<void> {
    try {
      await this.redis.del(CRM_GUIDANCE_CACHE_KEY);
    } catch (error) {
      // O TTL curto limita o atraso.
      this.logger.warn({ err: error }, 'não foi possível limpar o cache das orientações do CRM');
    }
  }
}

function isKey(key: string): key is CrmGuidanceKey {
  return crmGuidanceKeySchema.safeParse(key).success;
}

function assertKey(key: string): CrmGuidanceKey {
  if (!isKey(key)) throw new NotFoundException('Orientação não encontrada.');
  return key;
}
