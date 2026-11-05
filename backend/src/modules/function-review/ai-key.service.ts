import { Inject, Injectable } from '@nestjs/common';
import type { AiKeyView } from '@gptmaker/contracts';
import { eq } from 'drizzle-orm';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DB, type Database } from '../../shared/database/database.module';
import { tenantAiKey } from '../../shared/database/schema/index';
import { VibecodeClient } from '../vibecode';
import { verifyAiKey } from './ai-key-check';
import { platformKey } from './platform-key';

/**
 * Chave de IA do cliente (spec agent-knowledge-review, "Chave de IA do cliente"; design D6): uma
 * por tenant, cifrada em repouso. A tela só vê se há chave, os 4 últimos caracteres e o teste.
 */
@Injectable()
export class AiKeyService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly vibecode: VibecodeClient,
  ) {}

  async view(tenantId: string): Promise<AiKeyView> {
    const [row] = await this.db
      .select({ last4: tenantAiKey.last4, verifiedAt: tenantAiKey.verifiedAt })
      .from(tenantAiKey)
      .where(eq(tenantAiKey.tenantId, tenantId));
    return {
      configured: !!row,
      last4: row?.last4 ?? null,
      verifiedAt: row?.verifiedAt.toISOString() ?? null,
      creditsPerField: this.env.REVIEW_CREDITS_PER_FIELD,
      platformAvailable: !!platformKey(this.env),
    };
  }

  /** Testa no Vibecode e grava (ou troca) a chave; chave recusada não é salva. */
  async save(tenantId: string, apiKey: string): Promise<AiKeyView> {
    const model = this.env.VIBECODE_REVIEW_MODEL;
    await verifyAiKey(this.vibecode, model, apiKey);
    const now = new Date();
    const values = { apiKey, last4: apiKey.slice(-4), model, verifiedAt: now, updatedAt: now };
    await this.db
      .insert(tenantAiKey)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: tenantAiKey.tenantId, set: values });
    return this.view(tenantId);
  }

  async remove(tenantId: string): Promise<void> {
    await this.db.delete(tenantAiKey).where(eq(tenantAiKey.tenantId, tenantId));
  }

  /** A chave em claro, só para chamar o Vibecode; nunca sai por uma rota. */
  async find(tenantId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ apiKey: tenantAiKey.apiKey })
      .from(tenantAiKey)
      .where(eq(tenantAiKey.tenantId, tenantId));
    return row?.apiKey ?? null;
  }
}
