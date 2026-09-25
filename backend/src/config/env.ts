import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ROLE: z.enum(['api', 'worker']).default('api'),
  PORT: z.coerce.number().int().positive().default(3001),
  WORKER_HTTP_PORT: z.coerce.number().int().positive().default(9464),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: booleanFromString.default(false),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  RABBITMQ_URL: z.url(),
  /** Chave AES-256 (32 bytes em base64) das colunas cifradas. Gerar: `openssl rand -base64 32`. */
  DATA_ENCRYPTION_KEY: z.string().min(1),
  /** Aplica migrações no start da API (desligar só em testes ou execução manual). */
  RUN_MIGRATIONS: booleanFromString.default(true),
});

export type Env = z.infer<typeof envSchema>;
export type AppRole = Env['APP_ROLE'];

/** Lê e valida as variáveis de ambiente; falha no boot com a lista de problemas. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuração inválida:\n${issues}`);
  }
  return result.data;
}
