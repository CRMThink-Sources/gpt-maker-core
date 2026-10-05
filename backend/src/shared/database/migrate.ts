import { existsSync } from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/**
 * `backend/drizzle`, procurada subindo a partir deste arquivo: a profundidade varia entre `src/`
 * (Vitest), `dist/` (`nest build`, imagem) e `dist/src/` (`nest start -b swc`, dev).
 */
export const MIGRATIONS_FOLDER = findMigrationsFolder(__dirname);

function findMigrationsFolder(from: string): string {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'drizzle');
    if (existsSync(path.join(candidate, 'meta', '_journal.json'))) return candidate;
    if (path.dirname(dir) === dir) {
      throw new Error(`Pasta de migrações drizzle/ não encontrada acima de ${from}`);
    }
  }
}

// Chave arbitrária e fixa do advisory lock que serializa migrações entre processos.
const MIGRATION_LOCK_KEY = 72_401_337;

/** Aplica as migrações pendentes; chamado no start do papel `api`, antes de aceitar tráfego. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  // Erro de conexão ociosa não pode virar exceção não tratada; a migração em curso já falha sozinha.
  pool.on('error', () => {});
  const lockClient = await pool.connect();
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    lockClient.release();
    await pool.end();
  }
}
