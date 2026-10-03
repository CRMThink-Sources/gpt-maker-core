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

  // Backoffice (spec admin-backoffice, design D17): sessão de operador em cookie httpOnly
  /** Inatividade que encerra a sessão. */
  BACKOFFICE_SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(120),
  /** Duração máxima da sessão, mesmo em uso. */
  BACKOFFICE_SESSION_MAX_HOURS: z.coerce.number().int().positive().default(12),
  /** Cookie só por HTTPS; desligar apenas em desenvolvimento local (http://localhost). */
  BACKOFFICE_COOKIE_SECURE: booleanFromString.default(true),
  /** Nome que aparece no app autenticador. */
  BACKOFFICE_TOTP_ISSUER: z.string().min(1).default('ThinkFlow AI Backoffice'),

  // Reconciliação diária com o consumo real do GPTMaker (spec usage-reconciliation, design D7)
  /** Fuso dos dias do `credits-spent` (não documentado pelo GPTMaker; a confirmar). */
  RECONCILIATION_TIMEZONE: z.string().min(1).default('America/Sao_Paulo'),
  /** Diferença por agente e dia, em créditos, que não gera ajuste. */
  RECONCILIATION_TOLERANCE_CREDITS: z.coerce.number().int().nonnegative().default(2),
  /** Acima disso o ajuste não é lançado sozinho: fica para revisão, com alerta. */
  RECONCILIATION_REVIEW_THRESHOLD_CREDITS: z.coerce.number().int().positive().default(100),
  /** Dias para trás reprocessados a cada execução (consumo que chega atrasado). */
  RECONCILIATION_LOOKBACK_DAYS: z.coerce.number().int().positive().max(31).default(3),

  /** Agentes não removidos por tenant, igual para todos os planos (spec gptmaker-workspace). */
  TENANT_AGENT_LIMIT: z.coerce.number().int().positive().default(5),

  /**
   * Limites de treinamento do tenant sem plano na projeção local (ex.: trial antes do evento da
   * plataforma). Com plano, valem `max_trainings` e `max_document_storage_mb` do `plan_entitlement`.
   */
  TRAINING_DEFAULT_MAX_TRAININGS: z.coerce.number().int().positive().default(10),
  TRAINING_DEFAULT_MAX_STORAGE_MB: z.coerce.number().int().positive().default(50),

  /** Origens do frontend autorizadas por CORS a chamar a API, separadas por vírgula. */
  FRONTEND_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  /**
   * URL pública desta API (ex.: `https://api.<dominio>`), base dos webhooks e callbacks que o
   * GPTMaker chama. Em dev, o endereço do túnel para receber os eventos.
   */
  API_PUBLIC_URL: z
    .url()
    .default('http://localhost:3001')
    .transform((value) => value.replace(/\/+$/, '')),

  // crmthink-platform: instalação, tokens do Bitrix, sessão do iframe e cobrança (design D3/D9)
  PLATFORM_URL: z.url(),
  /** Chave de API do app (`credentials.apiKey` do cadastro). */
  PLATFORM_API_KEY: z.string().min(1),
  /**
   * Segredos vigentes dos webhooks (`credentials.webhookSecret`), separados por vírgula: durante a
   * rotação ficam o novo e o antigo por até 24h.
   */
  PLATFORM_WEBHOOK_SECRETS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(',')
        .map((secret) => secret.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string()).min(1)),
  /** `iss` esperado no JWT da sessão; padrão da plataforma é a própria `PLATFORM_URL`. */
  PLATFORM_JWT_ISSUER: z.url().optional(),
  PLATFORM_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // Armazenamento de documentos de treinamento: DigitalOcean Spaces (SeaweedFS em dev), design D14
  /** Endpoint S3 usado pela API (ex.: `https://nyc3.digitaloceanspaces.com`, `http://storage:8333`). */
  STORAGE_ENDPOINT: z.url(),
  /**
   * Endpoint das URLs pré-assinadas, que o GPTMaker baixa; a assinatura inclui o host. Em dev com
   * túnel, o endereço público do SeaweedFS. Sem valor, o mesmo do `STORAGE_ENDPOINT`.
   */
  STORAGE_PUBLIC_ENDPOINT: z.url().optional(),
  STORAGE_REGION: z.string().min(1).default('us-east-1'),
  STORAGE_BUCKET: z.string().min(1).default('gptmaker-trainings'),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  /** `true` para SeaweedFS (bucket no caminho); Spaces aceita o bucket no subdomínio. */
  STORAGE_FORCE_PATH_STYLE: booleanFromString.default(false),
  /** Validade das URLs pré-assinadas; o máximo do SigV4 é 7 dias. */
  STORAGE_PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().max(604_800).default(604_800),

  /**
   * Partições de `channel.inbound` (uma fila e um consumidor cada; ordem por diálogo). Mudar o
   * número redistribui os diálogos entre as filas: só com as filas vazias.
   */
  CHANNEL_INBOUND_PARTITIONS: z.coerce.number().int().positive().max(64).default(4),
  /**
   * Esperas entre as tentativas de uma mensagem do chatbot, em ms, separadas por vírgula
   * (design D5: 10 s, 1 min, 5 min). Esgotadas, a mensagem vai para a DLQ.
   */
  CHANNEL_RETRY_DELAYS_MS: z
    .string()
    .default('10000,60000,300000')
    .transform((value) =>
      value
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item > 0),
    )
    .pipe(z.array(z.number()).min(1).max(10)),

  /** Chamadas por segundo por portal Bitrix24 (limite do plano ~2 req/s, design D13). */
  BITRIX_RATE_LIMIT_PER_SECOND: z.coerce.number().int().positive().default(2),
  BITRIX_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
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
