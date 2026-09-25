import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { count } from 'drizzle-orm';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DB, type Database } from '../../shared/database/database.module';
import { aiModel } from '../../shared/database/schema/index';

type SeedModel = {
  code: string;
  displayName: string;
  creditsPerResponse: number;
  active?: boolean;
};

/**
 * Catálogo inicial: custo por resposta = tabela de cobrança do GPTMaker (1 crédito do cliente =
 * 1 crédito GPTMaker, margem no preço do plano; valores a confirmar). Descontinuados entram
 * inativos. Mapeamento enum → nome comercial inferido (docs/gptmaker-api.md §3).
 */
export const SEED_MODELS: readonly SeedModel[] = [
  { code: 'GPT_5_6_SOL', displayName: 'GPT-5.6 Sol', creditsPerResponse: 14 },
  { code: 'GPT_5_6_TERRA', displayName: 'GPT-5.6 Terra', creditsPerResponse: 7 },
  { code: 'GPT_5_6_LUNA', displayName: 'GPT-5.6 Luna', creditsPerResponse: 1 },
  { code: 'GPT_5_5', displayName: 'GPT-5.5', creditsPerResponse: 14 },
  { code: 'GPT_5_4', displayName: 'GPT-5.4', creditsPerResponse: 7 },
  { code: 'GPT_5_4_MINI', displayName: 'GPT-5.4 Mini', creditsPerResponse: 2 },
  { code: 'GPT_5_2', displayName: 'GPT-5.2', creditsPerResponse: 5 },
  { code: 'GPT_5_1', displayName: 'GPT-5.1', creditsPerResponse: 4 },
  { code: 'GPT_5', displayName: 'GPT-5', creditsPerResponse: 4 },
  { code: 'GPT_5_MINI', displayName: 'GPT-5 Mini', creditsPerResponse: 1 },
  { code: 'GPT_4_1', displayName: 'GPT-4.1', creditsPerResponse: 4 },
  { code: 'GPT_4_1_MINI', displayName: 'GPT-4.1 Mini', creditsPerResponse: 1 },
  { code: 'OPEN_AI_O4_MINI', displayName: 'o4-Mini', creditsPerResponse: 3 },
  { code: 'OPEN_AI_O3', displayName: 'o3', creditsPerResponse: 5 },
  { code: 'OPEN_AI_O3_MINI', displayName: 'o3-Mini', creditsPerResponse: 3 },
  { code: 'OPEN_AI_O1', displayName: 'o1', creditsPerResponse: 25 },
  { code: 'GPT_4_O', displayName: 'GPT-4o', creditsPerResponse: 5 },
  { code: 'GPT_4_O_MINI', displayName: 'GPT-4o Mini', creditsPerResponse: 1 },
  { code: 'GPT_4', displayName: 'GPT-4 Turbo', creditsPerResponse: 20 },
  { code: 'CLAUDE_5_SONNET', displayName: 'Claude 5 Sonnet', creditsPerResponse: 10 },
  { code: 'CLAUDE_4_6_SONNET', displayName: 'Claude 4.6 Sonnet', creditsPerResponse: 10 },
  { code: 'CLAUDE_4_5_SONNET', displayName: 'Claude 4.5 Sonnet', creditsPerResponse: 10 },
  { code: 'CLAUDE_4_5_HAIKU', displayName: 'Claude 4.5 Haiku', creditsPerResponse: 3 },
  {
    code: 'CLAUDE_3_7_SONNET',
    displayName: 'Claude 3.7 Sonnet',
    creditsPerResponse: 10,
    active: false,
  },
  {
    code: 'CLAUDE_3_5_SONNET',
    displayName: 'Claude 3.5 Sonnet',
    creditsPerResponse: 10,
    active: false,
  },
  {
    code: 'CLAUDE_3_5_HAIKU',
    displayName: 'Claude 3.5 Haiku',
    creditsPerResponse: 2,
    active: false,
  },
  { code: 'DEEPINFRA_LLAMA3_3', displayName: 'LLaMA 3.3 (Meta)', creditsPerResponse: 1 },
  { code: 'QWEN_2_5_MAX', displayName: 'Qwen 2.5 Max (Alibaba)', creditsPerResponse: 3 },
  { code: 'DEEPSEEK_V4_PRO', displayName: 'Deepseek V4 Pro', creditsPerResponse: 5 },
  { code: 'DEEPSEEK_V4_FLASH', displayName: 'Deepseek V4 Flash', creditsPerResponse: 1 },
  { code: 'DEEPSEEK_CHAT', displayName: 'Deepseek V3', creditsPerResponse: 1 },
  { code: 'SABIA_3_1', displayName: 'Sabiá 3.1 (Maritaca)', creditsPerResponse: 3 },
  { code: 'SABIA_3', displayName: 'Sabiá 3 (Maritaca)', creditsPerResponse: 3 },
];

export const SEED_DEFAULT_MODEL = 'GPT_5_MINI';

/**
 * Semeia o catálogo só quando ele está vazio (primeira subida): depois disso o backoffice é a
 * fonte, e um modelo removido não volta. Concorrência entre processos cai no índice único de
 * código (`onConflictDoNothing`).
 */
export async function seedAiModels(db: Database): Promise<number> {
  const [existing] = await db.select({ total: count() }).from(aiModel);
  if ((existing?.total ?? 0) > 0) return 0;
  const inserted = await db
    .insert(aiModel)
    .values(
      SEED_MODELS.map((model) => ({
        code: model.code,
        displayName: model.displayName,
        creditsPerResponse: model.creditsPerResponse,
        active: model.active ?? true,
        isDefault: model.code === SEED_DEFAULT_MODEL,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: aiModel.id });
  return inserted.length;
}

/** Roda no papel `api`, depois das migrações aplicadas no start. */
@Injectable()
export class ModelSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(ModelSeeder.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.APP_ROLE !== 'api') return;
    // Falha no seed (ex.: migrações ainda não aplicadas) não impede a API de subir.
    try {
      const inserted = await seedAiModels(this.db);
      if (inserted > 0) this.logger.log({ inserted }, 'catálogo de modelos semeado');
    } catch (error) {
      this.logger.error({ alert: true, err: error }, 'falha ao semear o catálogo de modelos');
    }
  }
}
