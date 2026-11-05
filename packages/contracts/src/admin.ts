import { z } from 'zod';

/**
 * Backoffice (spec admin-backoffice, design D17): operadores com senha + TOTP, perfis `ADMIN`
 * (altera) e `SUPPORT` (consulta). Toda escrita em `/admin` leva o cabeçalho `X-Backoffice: 1`.
 */
export const BACKOFFICE_HEADER = 'X-Backoffice';

export type OperatorRole = 'ADMIN' | 'SUPPORT';

/** Mínimo de 12 caracteres (NIST 800-63B: tamanho vale mais que regras de composição). */
export const operatorPasswordSchema = z.string().min(12, 'Use pelo menos 12 caracteres').max(200);

export const adminLoginSchema = z.object({
  email: z.string().trim().pipe(z.email('E-mail inválido')),
  password: z.string().min(1).max(200),
});

export const adminTotpSchema = z.object({
  challenge: z.string().min(1).max(200),
  code: z.string().regex(/^\d{6}$/, 'Código de 6 dígitos'),
  /** Lembrar este navegador: os próximos logins nele pedem só a senha, por alguns dias. */
  rememberDevice: z.boolean().optional(),
});

/**
 * Resposta do primeiro passo. `totp`: pedir o código do app autenticador. `totp-setup`: primeiro
 * acesso, mostrar o QR (`otpauthUrl`) e o segredo; o código confirma a configuração.
 * `authenticated`: navegador lembrado, a sessão já foi aberta sem pedir o código.
 */
export type AdminLoginStep =
  | { step: 'totp'; challenge: string }
  | { step: 'totp-setup'; challenge: string; otpauthUrl: string; secret: string }
  | ({ step: 'authenticated' } & AdminSessionView);

export interface OperatorView {
  id: string;
  email: string;
  name: string;
  role: OperatorRole;
  active: boolean;
  /** TOTP já configurado (senão, o próximo login pede a configuração). */
  totpConfigured: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminSessionView {
  operator: Pick<OperatorView, 'id' | 'email' | 'name' | 'role'>;
}

export const changePasswordSchema = z.object({
  current: z.string().min(1).max(200),
  next: operatorPasswordSchema,
});

export const createOperatorSchema = z.object({
  email: z.string().trim().pipe(z.email('E-mail inválido')),
  name: z.string().trim().min(1).max(120),
  role: z.enum(['ADMIN', 'SUPPORT']),
});

/** Criado com senha temporária, mostrada uma vez para o ADMIN repassar. */
export interface CreatedOperatorView {
  operator: OperatorView;
  temporaryPassword: string;
}

export const updateOperatorSchema = z.object({
  active: z.boolean().optional(),
  role: z.enum(['ADMIN', 'SUPPORT']).optional(),
});

// ---- Planos e direitos (15.2)

export interface AdminPlanModel {
  id: string;
  code: string;
  displayName: string;
  creditsPerResponse: number;
  isDefault: boolean;
  active: boolean;
}

/**
 * Plano do SPA 1138 (via crmthink-platform) com os direitos do app. `rights` nulo: sem direitos,
 * o plano não aparece para venda. `onPlatform` falso: direitos de um plano que a plataforma não
 * lista mais (inativo ou de outro ambiente).
 */
export interface AdminPlanView {
  id: number;
  name: string;
  type: 'subscription' | 'one_time';
  interval: 'monthly' | 'quarterly' | 'semiannual' | 'yearly' | null;
  /** Centavos, como no CRM. */
  amount: number;
  trial: boolean;
  onPlatform: boolean;
  rights: {
    active: boolean;
    creditsPerCycle: number | null;
    creditsPerPackage: number | null;
    /** Nulo = sem limite. */
    maxTrainings: number | null;
    maxDocumentStorageMb: number | null;
    allowedModelIds: string[];
    updatedBy: string | null;
    updatedAt: string;
  } | null;
  /** Assinaturas abertas (trial, ativa ou em atraso) neste plano. */
  subscribers: number;
}

export interface AdminPlansView {
  plans: AdminPlanView[];
  models: AdminPlanModel[];
}

const optionalLimit = z.number().int().positive().max(1_000_000).nullable();

export const updatePlanRightsSchema = z
  .object({
    type: z.enum(['subscription', 'one_time']),
    active: z.boolean(),
    creditsPerCycle: z.number().int().min(0).max(10_000_000).nullable(),
    creditsPerPackage: z.number().int().positive().max(10_000_000).nullable(),
    maxTrainings: optionalLimit,
    maxDocumentStorageMb: optionalLimit,
    allowedModelIds: z.array(z.uuid()).max(100),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'subscription' && value.creditsPerCycle === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['creditsPerCycle'],
        message: 'Informe os créditos por ciclo',
      });
    }
    if (value.type === 'one_time' && value.creditsPerPackage === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['creditsPerPackage'],
        message: 'Informe os créditos do pacote',
      });
    }
  });

export type UpdatePlanRightsInput = z.infer<typeof updatePlanRightsSchema>;

// ---- Tenants (15.4)

export type TenantStatusView = 'ACTIVE' | 'SUSPENDED' | 'AUTH_ERROR' | 'UNINSTALLED';
export type SubscriptionStatusView =
  'trialing' | 'active' | 'past_due' | 'cancelled' | 'trial_expired';

export interface AdminTenantRow {
  id: string;
  domain: string;
  tenantCode: string;
  installationId: string;
  status: TenantStatusView;
  /** Parceiro: pode assumir o controle do comportamento dos agentes. */
  isPartner: boolean;
  subscription: {
    status: SubscriptionStatusView;
    planId: string | null;
    modality: 'stripe' | 'manual';
  } | null;
  balance: { trial: number; plan: number; extra: number; total: number };
  agents: { active: number; total: number };
  lastMessageAt: string | null;
  installedAt: string;
}

export interface AdminTenantDetail extends AdminTenantRow {
  suspendedReason: string | null;
  uninstalledAt: string | null;
  subscriptionDetail: {
    subscriptionId: string;
    periodStart: string | null;
    periodEnd: string | null;
    graceUntil: string | null;
    cancelAt: string | null;
    nextPlanId: string | null;
  } | null;
  trialEndsAt: string | null;
  expiresAt: string | null;
  agentList: Array<{
    id: string;
    name: string;
    gptmakerAgentId: string;
    status: 'ACTIVE' | 'INACTIVE' | 'DELETED' | 'OUT_OF_SYNC';
    inactiveReason: string | null;
    model: string | null;
  }>;
  /** Movimentações sem os débitos por resposta (esses aparecem em `usage7d`). */
  entries: Array<{
    id: string;
    createdAt: string;
    type: string;
    wallet: 'TRIAL' | 'PLAN' | 'EXTRA';
    amount: number;
    reason: string | null;
    createdBy: string;
  }>;
  /** Respostas e créditos debitados nos últimos 7 dias. */
  usage7d: { responses: number; credits: number };
  notifications: Array<{ type: string; status: string; createdAt: string; sentTo: string[] }>;
}

export const suspendTenantSchema = z.object({
  reason: z.string().trim().min(5, 'Explique o motivo (mínimo 5 caracteres)').max(500),
});

/** Marca ou desmarca o portal como parceiro (spec admin-backoffice, "Tenant parceiro"). */
export const setTenantPartnerSchema = z.object({ partner: z.boolean() });

export const grantCreditsSchema = z.object({
  amount: z.number().int().positive().max(1_000_000),
  reason: z.string().trim().min(5, 'Explique o motivo (mínimo 5 caracteres)').max(500),
  /** Gerado no navegador: o mesmo pedido enviado duas vezes concede uma vez. */
  requestId: z.uuid(),
});

// ---- Modelos de IA (15.3, 14.3)

export interface AdminModelView {
  id: string;
  code: string;
  displayName: string;
  description: string | null;
  creditsPerResponse: number;
  active: boolean;
  isDefault: boolean;
  /** Agentes não removidos usando o modelo. */
  agentsUsing: number;
  /** Planos que liberam o modelo. */
  plansAllowing: number;
  /**
   * Reconciliação dos últimos 30 dias: média real (créditos do GPTMaker ÷ respostas), custo
   * sugerido (média dos últimos 7 dias) e se está defasado (7 dias seguidos fora do custo).
   */
  insight: {
    average: number | null;
    real: number;
    responses: number;
    suggestion: number | null;
    stale: boolean;
  };
}

export interface AdminModelCostChange {
  changedAt: string;
  previousCost: number;
  newCost: number;
  /** Nome do operador (ou o autor registrado). */
  changedBy: string;
}

// ---- Workspace GPTMaker (15.6)

export interface AdminWorkspaceView {
  /** Último estado do job `workspace-health` (a cada 15 min); `null` antes da primeira checagem. */
  status: {
    state: 'up' | 'down';
    checkedAt: string;
    reason: string | null;
    subscriptionStatus: string | null;
    credits: number | null;
  } | null;
  orphans: Array<{
    findingId: string;
    gptmakerAgentId: string;
    name: string | null;
    detectedAt: string;
    /** Portal sugerido pela criação registrada no app (ou pelo prefixo legado `[código]` do nome). */
    suggestedTenant: { id: string; domain: string; tenantCode: string } | null;
    /** Órfão de um agente removido no app: só pode ser removido do GPTMaker. */
    removedLocally: boolean;
  }>;
  outOfSync: Array<{
    agentId: string;
    name: string;
    gptmakerAgentId: string;
    tenant: { id: string; domain: string };
    detectedAt: string | null;
  }>;
  /** Correções e resoluções recentes (status reaplicado, órfãos resolvidos), mais novas primeiro. */
  recent: Array<{
    kind: 'ORPHAN' | 'MISSING' | 'STATUS_MISMATCH';
    gptmakerAgentId: string;
    resolvedAt: string;
    resolvedBy: string | null;
    resolution: string | null;
  }>;
}

export const linkOrphanSchema = z.object({ tenantId: z.uuid() });

export interface WorkspaceSyncView {
  /** `null`: o job já estava rodando. */
  summary: {
    remoteAgents: number;
    localAgents: number;
    orphansFound: number;
    missingConfirmed: number;
    statusCorrected: number;
    findingsResolved: number;
  } | null;
}

// ---- Reconciliação: revisão de ajustes (14.2) e relatório do partner (14.4/15.7)

export interface AdminReconciliationReview {
  agentId: string;
  agentName: string;
  tenant: { id: string; domain: string };
  /** AAAA-MM-DD, no fuso da reconciliação. */
  day: string;
  /** Consumo real no GPTMaker. */
  real: number;
  debited: number;
  /** Já ajustado no ledger para o dia (positivo devolveu créditos, negativo cobrou). */
  adjusted: number;
  /** Ajuste que a aprovação lança: `debitado - real - ajustado`. */
  pending: number;
  status: 'REVIEW' | 'APPROVED' | 'DISMISSED';
  /** Nome do operador que decidiu. */
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface AdminReconciliationReviewsView {
  open: AdminReconciliationReview[];
  /** Últimas decisões, mais novas primeiro. */
  recent: AdminReconciliationReview[];
  /** Diferença que manda para revisão, em créditos. */
  reviewThreshold: number;
}

export const reviewDecisionSchema = z.object({
  decision: z.enum(['approve', 'dismiss']),
});
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;

export const partnerReportQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês no formato AAAA-MM'),
});

/** Valores em centavos. Assinaturas são estimadas pelo preço do plano (os eventos não trazem valor). */
export interface PartnerRevenue {
  subscriptions: number;
  packages: number;
  refunds: number;
  total: number;
}

export interface PartnerCredits {
  /** Consumo real no GPTMaker (custo do partner). */
  consumed: number;
  /** Débitos por resposta. */
  debited: number;
  /** Ajustes da reconciliação (positivo devolveu, negativo cobrou). */
  adjusted: number;
  /** Cobrado do cliente: `debitado - ajustado`. */
  charged: number;
}

export interface PartnerReportView {
  month: string;
  timeZone: string;
  daysInPeriod: number;
  /** Dias do período já reconciliados (consumo coletado). */
  daysReconciled: number;
  /** Preço do crédito para o partner (env); `null` ⇒ sem custo/margem em reais. */
  creditCostCents: number | null;
  /** Planos da plataforma indisponíveis: receita de assinaturas não estimada. */
  platformError: boolean;
  pendingReviews: number;
  totals: PartnerCredits & {
    /** Consumo de agentes sem vínculo com portal (já incluso em `consumed`). */
    unlinked: number;
    revenue: PartnerRevenue;
    costCents: number | null;
    marginCents: number | null;
  };
  tenants: Array<
    PartnerCredits & {
      tenant: { id: string; domain: string };
      revenue: PartnerRevenue;
      costCents: number | null;
      marginCents: number | null;
      agents: Array<PartnerCredits & { agentId: string; name: string; removed: boolean }>;
    }
  >;
  unlinked: Array<{ gptmakerAgentId: string; name: string | null; consumed: number }>;
}

// ---- Auditoria (15.8)

export const auditQuerySchema = z.object({
  tenantId: z.uuid().optional(),
  actorId: z.string().min(1).max(100).optional(),
  /** Prefixo da ação (ex.: `tenant.`, `model.created`). */
  action: z.string().min(1).max(100).optional(),
  /** Cursor da página anterior (`nextCursor`). */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditQueryInput = z.input<typeof auditQuerySchema>;

export interface AdminAuditEntry {
  id: string;
  createdAt: string;
  actor: { type: 'OPERATOR' | 'TENANT_USER' | 'SYSTEM'; id: string; name: string | null };
  tenant: { id: string; domain: string } | null;
  /** Ação nomeada (ex.: `tenant.suspended`) ou, sem registro próprio, a rota (`POST /admin/...`). */
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  traceId: string | null;
}

export interface AdminAuditPage {
  /** Mais novas primeiro. */
  items: AdminAuditEntry[];
  nextCursor: string | null;
}

// ---- Assinatura do portal (15.5)

export interface AdminPlatformEvent {
  eventId: string;
  type: string;
  /** Quando aconteceu na plataforma (`occurredAt`). */
  occurredAt: string | null;
  receivedAt: string;
  status: 'RECEIVED' | 'PROCESSED' | 'OBSOLETE' | 'FAILED';
  attempts: number;
  error: string | null;
  /** Gerado pelo job de consistência (evento que faltou), não recebido da plataforma. */
  correction: boolean;
  payload: unknown;
}

export interface AdminSubscriptionView {
  /** Projeção local (`subscription_state`); `null` sem trial nem plano. */
  projection: {
    subscriptionId: string;
    status: SubscriptionStatusView;
    modality: 'stripe' | 'manual';
    plan: { id: string; name: string | null } | null;
    nextPlan: { id: string; name: string | null } | null;
    periodStart: string | null;
    periodEnd: string | null;
    graceUntil: string | null;
    cancelAt: string | null;
    version: number;
    updatedAt: string;
  } | null;
  /** Itens no portal CRMThink (SPA de Assinaturas e de Instalações). */
  links: { subscription: string | null; installation: string };
  /** Mais novos primeiro. */
  events: AdminPlatformEvent[];
  /** Planos da plataforma indisponíveis: nomes dos planos ausentes. */
  platformError: boolean;
}

export interface AdminSubscriptionCheckView {
  /** `ok`: projeção igual à plataforma; `corrected`: evento que faltou aplicado; `alert`: divergência que exige ação manual. */
  outcome: 'ok' | 'corrected' | 'alert';
  view: AdminSubscriptionView;
}

// ---- DLQ e erros por portal (15.7)

export type DeadLetterQueueKey = 'inbound' | 'transfer';

export interface AdminDeadLetterQueue {
  key: DeadLetterQueueKey;
  name: string;
  /** `null`: RabbitMQ indisponível. */
  messages: number | null;
}

export interface AdminDeadLetterMessage {
  tenant: { id: string; domain: string } | null;
  agentId: string | null;
  dialogId: string | null;
  /** Id da mensagem do Bitrix (inbound) ou do evento do agente (transferência). */
  reference: string | null;
  attempts: number | null;
  lastError: string | null;
  /** Quando chegou (inbound) ou `null`. */
  receivedAt: string | null;
}

export interface AdminDeadLetterPeek {
  queue: AdminDeadLetterQueue;
  /** Primeiras mensagens da fila (só metadados; o texto do cliente não sai daqui). */
  messages: AdminDeadLetterMessage[];
}

export type FailureSource =
  | 'message'
  | 'trigger'
  | 'intention'
  | 'training'
  | 'platform_event'
  | 'platform_outbox'
  | 'notification';

export interface AdminFailure {
  source: FailureSource;
  at: string;
  /** O que falhou (agente, gatilho, evento...). */
  subject: string;
  error: string | null;
  attempts: number | null;
}

export interface AdminFailuresRanking {
  tenant: { id: string; domain: string };
  total: number;
  bySource: Partial<Record<FailureSource, number>>;
  lastAt: string;
}

export interface AdminOperationsView {
  queues: AdminDeadLetterQueue[];
  /** Portais com falhas nos últimos 7 dias, mais falhas primeiro. */
  ranking: AdminFailuresRanking[];
}

export interface AdminTenantFailures {
  /** Últimos 30 dias, mais recentes primeiro. */
  items: AdminFailure[];
}
