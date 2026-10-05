import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadEnv } from '../config/env';
import { OperatorService } from '../modules/backoffice/operator.service';
import { configureFieldCipher } from '../shared/crypto/field-cipher';
import * as schema from '../shared/database/schema/index';

/**
 * Cria um operador do backoffice pela linha de comando (o primeiro ADMIN não tem quem o crie pela
 * tela). Imprime a senha temporária uma vez; o TOTP é configurado no primeiro login.
 *
 *   node dist/cli/create-operator.js --email ana@empresa.com --name "Ana" [--role SUPPORT]
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string', default: 'ADMIN' },
    },
  });
  if (!values.email || !values.name || !['ADMIN', 'SUPPORT'].includes(values.role ?? '')) {
    console.error('Uso: create-operator --email <e-mail> --name <nome> [--role ADMIN|SUPPORT]');
    process.exitCode = 1;
    return;
  }
  const env = loadEnv({ ...process.env, APP_ROLE: 'api' });
  configureFieldCipher(env.DATA_ENCRYPTION_KEY);
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const operators = new OperatorService(drizzle(pool, { schema }));
    const { operator, temporaryPassword } = await operators.create({
      email: values.email,
      name: values.name,
      role: values.role as 'ADMIN' | 'SUPPORT',
    });
    console.log(`Operador ${operator.email} (${operator.role}) criado.`);
    console.log(`Senha temporária (mostrada só agora): ${temporaryPassword}`);
    console.log(
      'No primeiro login, configure o app autenticador e troque a senha em "Minha conta".',
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
