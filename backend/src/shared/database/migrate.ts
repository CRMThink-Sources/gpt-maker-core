import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/** `backend/drizzle`, igual a partir de `src/` (dev) e de `dist/` (imagem). */
export const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../../drizzle');

// Chave arbitrária e fixa do advisory lock que serializa migrações entre processos.
const MIGRATION_LOCK_KEY = 72_401_337;

/** Aplica as migrações pendentes; chamado no start do papel `api`, antes de aceitar tráfego. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
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
