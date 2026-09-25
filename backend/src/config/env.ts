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

  // GPTMaker (conta partner, workspace único compartilhado — design D2 e D4)
  GPTMAKER_API_URL: z.url().default('https://api.gptmaker.ai/v2'),
  /** Token do partner; nunca vai para o banco nem para o frontend. */
  GPTMAKER_API_TOKEN: z.string().min(1),
  GPTMAKER_WORKSPACE_ID: z.string().min(1),
  /** Limite global de chamadas por segundo (token único, somado entre api e worker). */
  GPTMAKER_RATE_LIMIT_PER_SECOND: z.coerce.number().int().positive().default(5),
  GPTMAKER_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  /** `/conversation` é síncrono na v1 e pode demorar (design D5). */
  GPTMAKER_CONVERSATION_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  /** Agentes não removidos por tenant, igual para todos os planos (spec gptmaker-workspace). */
  TENANT_AGENT_LIMIT: z.coerce.number().int().positive().default(5),
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
