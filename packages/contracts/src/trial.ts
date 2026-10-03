import { z } from 'zod';

const contactText = z.string().trim().min(1, 'Preencha este campo').max(200);

/**
 * Cadastro pedido para ativar o trial (spec payments-integration, "Trial liberado por cadastro").
 * Espelha o `trialRequestSchema` do crmthink-platform, que valida de novo e decide.
 */
export const trialRequestSchema = z.object({
  name: contactText,
  email: z.string().trim().pipe(z.email('E-mail inválido').max(200)),
  phone: contactText,
  company: contactText,
  role: contactText,
});

export type TrialRequest = z.infer<typeof trialRequestSchema>;

export const TRIAL_FIELD_LABELS: Record<keyof TrialRequest, string> = {
  name: 'Nome',
  email: 'E-mail',
  phone: 'Telefone ou WhatsApp',
  company: 'Empresa',
  role: 'Cargo',
};

/**
 * Situação do trial para a tela de planos:
 * - `available`: nunca teve assinatura; oferece o trial;
 * - `activating`: cadastro aceito, esperando o `subscription.trial_started`;
 * - `trialing`: trial em andamento (créditos concedidos);
 * - `unavailable`: já teve trial ou plano; mostra os planos.
 */
export type TrialState = 'available' | 'activating' | 'trialing' | 'unavailable';

export interface TrialStatusView {
  state: TrialState;
  /** Fim do trial (ISO), quando conhecido. */
  trialEndsAt: string | null;
}
