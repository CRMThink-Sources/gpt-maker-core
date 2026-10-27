import { Pool, type PoolConfig } from 'pg';

/**
 * Pool dos testes de integração. `pool.end()` resolve antes de as conexões terminarem de fechar;
 * o `postgres.stop()` logo em seguida derruba o servidor e as conexões ainda abertas recebem
 * `57P01 terminating connection due to administrator command`. Sem ouvinte de `error`, isso vira
 * exceção não tratada e o Vitest reprova o run mesmo com os testes passando (o mesmo cuidado de
 * `runMigrations`).
 */
export function testPool(connectionString: string, config: PoolConfig = {}): Pool {
  const pool = new Pool({ ...config, connectionString });
  pool.on('error', () => {});
  return pool;
}
