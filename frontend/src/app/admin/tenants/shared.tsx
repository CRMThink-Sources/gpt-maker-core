import type { SubscriptionStatusView, TenantStatusView } from '@gptmaker/contracts';
import { Badge, type Tone } from '@/components/ui';

const TENANT_STATUS: Record<TenantStatusView, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Ativo', tone: 'green' },
  SUSPENDED: { label: 'Suspenso', tone: 'amber' },
  AUTH_ERROR: { label: 'Erro de autorização', tone: 'amber' },
  UNINSTALLED: { label: 'Desinstalado', tone: 'zinc' },
};

const SUBSCRIPTION_STATUS: Record<SubscriptionStatusView, { label: string; tone: Tone }> = {
  trialing: { label: 'Teste grátis', tone: 'brand' },
  active: { label: 'Plano ativo', tone: 'green' },
  past_due: { label: 'Pagamento pendente', tone: 'amber' },
  cancelled: { label: 'Encerrada', tone: 'zinc' },
  trial_expired: { label: 'Teste encerrado', tone: 'zinc' },
};

export function TenantStatusBadge({ status }: { status: TenantStatusView }) {
  const meta = TENANT_STATUS[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function SubscriptionBadge({
  subscription,
}: {
  subscription: { status: SubscriptionStatusView; planId: string | null } | null;
}) {
  if (!subscription) return <Badge tone="zinc">Sem assinatura</Badge>;
  const meta = SUBSCRIPTION_STATUS[subscription.status];
  return (
    <Badge tone={meta.tone}>
      {meta.label}
      {subscription.planId ? ` · plano ${subscription.planId}` : ''}
    </Badge>
  );
}

export function credits(value: number): string {
  return value.toLocaleString('pt-BR');
}

export function dateTime(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : '—';
}
