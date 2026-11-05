import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { ApiModule } from '../api.module';
import { loadEnv } from '../config/env';
import { AgentService } from '../modules/agents';
import { DB, type Database } from '../shared/database/database.module';
import { discardLegacyAgents } from './legacy-agents';

/**
 * Remove os agentes de teste, criados antes das funções (design, "Migration Plan"). Sem `--apply`,
 * só lista. Sobe o contexto do papel `api` (sem consumidores de fila) para a remoção avisar
 * chatbot e intenções como a remoção pela tela.
 *
 *   node dist/src/cli/discard-legacy-agents.js [--apply]
 */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } } });
  const env = loadEnv({ ...process.env, APP_ROLE: 'api' });
  const app = await NestFactory.createApplicationContext(ApiModule.forRoot(env), {
    logger: ['error', 'warn'],
  });
  try {
    const result = await discardLegacyAgents({
      db: app.get<Database>(DB),
      agents: app.get(AgentService),
      apply: values.apply,
      log: (line) => console.log(line),
    });
    console.log(
      values.apply
        ? `Removidos: ${result.removed}; falhas: ${result.failed}.`
        : `Sem função: ${result.pending}. Rode com --apply para remover.`,
    );
    if (result.failed) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
