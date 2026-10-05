import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { loadEnv } from '../config/env';
import { remoteProfile } from '../modules/agents/agent.service';
import { tenantCodeFromGptMakerName } from '../modules/gptmaker/agent-naming';
import { GptMakerClient } from '../modules/gptmaker/gptmaker.client';
import { GptMakerResilience } from '../modules/gptmaker/gptmaker.resilience';
import * as schema from '../shared/database/schema/index';
import { DistributedLock } from '../shared/redis/distributed-lock';

/** Mesmo lock da edição do agente (`AgentService`): não corre junto com uma edição do cliente. */
const AGENT_LOCK_TTL_MS = 90_000;

/**
 * Tira o prefixo legado `[<tenantCode>]` do nome dos agentes no GPTMaker (tarefa 7.9), enviando o
 * perfil local. Sem `--apply`, só lista. Nomes diferentes do local mas sem o prefixo (renomeados à
 * mão no painel) só são apontados, não sobrescritos.
 *
 *   node dist/src/cli/strip-agent-prefix.js [--apply]
 */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } } });
  const env = loadEnv({ ...process.env, APP_ROLE: 'worker' });
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const redis = new Redis(env.REDIS_URL);
  const lock = new DistributedLock(redis);
  const gptmaker = new GptMakerClient(
    {
      baseUrl: env.GPTMAKER_API_URL,
      token: env.GPTMAKER_API_TOKEN,
      workspaceId: env.GPTMAKER_WORKSPACE_ID,
      timeoutMs: env.GPTMAKER_TIMEOUT_MS,
      conversationTimeoutMs: env.GPTMAKER_CONVERSATION_TIMEOUT_MS,
    },
    new GptMakerResilience({
      maxAttempts: 3,
      breakerThreshold: 5,
      halfOpenAfterMs: 30_000,
      beforeAttempt: async () => {},
    }),
  );

  const counts = { renamed: 0, pending: 0, ok: 0, manual: 0, failed: 0 };
  try {
    const db = drizzle(pool, { schema });
    const agents = await db
      .select()
      .from(schema.agent)
      .where(inArray(schema.agent.status, ['ACTIVE', 'INACTIVE']));

    for (const row of agents) {
      const label = `${row.name} (${row.gptmakerAgentId})`;
      try {
        const remoteName = (await gptmaker.getAgent(row.gptmakerAgentId)).name ?? '';
        if (remoteName === row.name.trim()) {
          counts.ok++;
          continue;
        }
        if (!tenantCodeFromGptMakerName(remoteName)) {
          counts.manual++;
          console.log(`- ${label}: no GPTMaker está "${remoteName}"; não alterado`);
          continue;
        }
        if (!values.apply) {
          counts.pending++;
          console.log(`- ${label}: "${remoteName}" ⇒ "${row.name.trim()}"`);
          continue;
        }
        const outcome = await lock.runExclusive(
          `agent:${row.tenantId}:${row.id}`,
          AGENT_LOCK_TTL_MS,
          () => gptmaker.updateAgent(row.gptmakerAgentId, remoteProfile(row)),
        );
        if (!outcome.ran) {
          counts.failed++;
          console.log(`- ${label}: em edição agora; rode de novo`);
          continue;
        }
        counts.renamed++;
        console.log(`- ${label}: renomeado`);
      } catch (error) {
        counts.failed++;
        console.log(`- ${label}: falhou (${error instanceof Error ? error.message : error})`);
      }
    }
  } finally {
    redis.disconnect();
    await pool.end();
  }

  console.log(
    values.apply
      ? `Renomeados: ${counts.renamed}; já sem prefixo: ${counts.ok}; nome manual: ${counts.manual}; falhas: ${counts.failed}.`
      : `Com prefixo: ${counts.pending}; já sem prefixo: ${counts.ok}; nome manual: ${counts.manual}; falhas: ${counts.failed}. Rode com --apply para renomear.`,
  );
  if (counts.failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
