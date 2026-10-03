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
});

/**
 * Resposta do primeiro passo. `totp`: pedir o código do app autenticador. `totp-setup`: primeiro
 * acesso, mostrar o QR (`otpauthUrl`) e o segredo; o código confirma a configuração.
 */
export type AdminLoginStep =
  | { step: 'totp'; challenge: string }
  | { step: 'totp-setup'; challenge: string; otpauthUrl: string; secret: string };

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
