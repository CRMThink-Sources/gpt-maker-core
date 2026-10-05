import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import * as schema from './schema/index';

export const PG_POOL = Symbol('PG_POOL');
export const DB = Symbol('DB');
export type Database = NodePgDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ENV],
      useFactory: (env: Env) => {
        const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
        // Conexão ociosa derrubada pelo servidor (reinício, failover: 57P01) sai do pool sozinha;
        // sem este handler, o 'error' viraria exceção não tratada e derrubaria o processo.
        pool.on('error', (error) =>
          new Logger('Database').warn({ err: error }, 'conexão ociosa do Postgres encerrada'),
        );
        return pool;
      },
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database => drizzle(pool, { schema }),
    },
  ],
  exports: [PG_POOL, DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
