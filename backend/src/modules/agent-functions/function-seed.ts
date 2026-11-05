import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { functionBlockContentSchema, functionTemplateDraftSchema } from '@gptmaker/contracts';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DB, type Database } from '../../shared/database/database.module';
import { agentFunctionBlock, agentFunctionTemplate } from '../../shared/database/schema/index';
import { FunctionCatalog } from './function-catalog.service';
import { SEED_BLOCKS, SEED_TEMPLATES } from './seed/index';

/**
 * Semeia blocos e funções que ainda não existem (design D10): o bloco entra publicado e a função
 * ganha a versão 1. O que já existe, pelo código, nunca é sobrescrito: depois da primeira subida o
 * backoffice é a fonte. Concorrência entre processos cai no índice único de código.
 */
export async function seedAgentFunctions(
  db: Database,
  catalog: FunctionCatalog,
): Promise<{ blocks: number; templates: number }> {
  const blocks = await db
    .insert(agentFunctionBlock)
    .values(
      SEED_BLOCKS.map((block) => {
        const content = functionBlockContentSchema.parse(block.content);
        return {
          code: block.code,
          name: block.name,
          draft: content,
          content,
          publishedAt: new Date(),
        };
      }),
    )
    .onConflictDoNothing()
    .returning({ code: agentFunctionBlock.code });

  let templates = 0;
  for (const template of SEED_TEMPLATES) {
    const [inserted] = await db
      .insert(agentFunctionTemplate)
      .values({
        code: template.code,
        name: template.name,
        description: template.description,
        draft: functionTemplateDraftSchema.parse(template.draft),
      })
      .onConflictDoNothing()
      .returning({ code: agentFunctionTemplate.code });
    if (!inserted) continue;
    await catalog.publishTemplate(template.code, null);
    templates++;
  }
  return { blocks: blocks.length, templates };
}

/** Roda no papel `api`, depois das migrações aplicadas no start. */
@Injectable()
export class FunctionSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(FunctionSeeder.name);

  constructor(
    private readonly catalog: FunctionCatalog,
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.APP_ROLE !== 'api') return;
    // Falha no seed não impede a API de subir; o alerta vai para o log.
    try {
      const seeded = await seedAgentFunctions(this.db, this.catalog);
      if (seeded.blocks || seeded.templates) this.logger.log(seeded, 'funções do agente semeadas');
    } catch (error) {
      this.logger.error({ alert: true, err: error }, 'falha ao semear as funções do agente');
    }
  }
}
