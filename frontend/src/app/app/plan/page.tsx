'use client';

import {
  type CreditSummaryView,
  TRIAL_FIELD_LABELS,
  type TrialRequest,
  trialRequestSchema,
  type TrialStatusView,
} from '@gptmaker/contracts';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { CheckIcon, SparkIcon } from '@/components/icons';
import { Alert, buttonClass, Card, Loading, PageHeader, Spinner } from '@/components/ui';
import { errorMessage } from '@/lib/agents';
import { bx24Call } from '@/lib/bx24';
import { ApiRequestError } from '@/lib/platform-session';
import { Field, inputClass } from '../agents/agent-fields';
import { BalanceSection, EntriesSection, UsageSection } from './credits-sections';
import { useAppSession } from '../session-provider';

/** Intervalo da consulta enquanto o trial é ativado (o evento da plataforma leva segundos). */
const POLL_MS = 3000;

const FIELDS: Array<{ key: keyof TrialRequest; type: string; autoComplete: string }> = [
  { key: 'name', type: 'text', autoComplete: 'name' },
  { key: 'email', type: 'email', autoComplete: 'email' },
  { key: 'phone', type: 'tel', autoComplete: 'tel' },
  { key: 'company', type: 'text', autoComplete: 'organization' },
  { key: 'role', type: 'text', autoComplete: 'organization-title' },
];

type FieldErrors = Partial<Record<keyof TrialRequest, string>>;

/**
 * Campos recusados, do zod local (`path: ['phone']`) ou da plataforma repassada pela API
 * (`path: 'phone'`).
 */
function fieldErrors(details: unknown): FieldErrors {
  if (!Array.isArray(details)) return {};
  const errors: FieldErrors = {};
  for (const issue of details as Array<{ path?: unknown; message?: string }>) {
    const key = (Array.isArray(issue.path) ? issue.path[0] : issue.path) as keyof TrialRequest;
    if (key in TRIAL_FIELD_LABELS && !errors[key]) errors[key] = issue.message ?? 'Campo inválido';
  }
  return errors;
}

/** Nome e e-mail do usuário do Bitrix para adiantar o cadastro; sem BX24, fica em branco. */
async function currentUserEmail(): Promise<string> {
  try {
    return (await bx24Call<{ EMAIL?: string }>('user.current', {})).EMAIL ?? '';
  } catch {
    return '';
  }
}

function TrialForm({ onActivated }: { onActivated: (status: TrialStatusView) => void }) {
  const { session, api } = useAppSession();
  const [values, setValues] = useState<TrialRequest>({
    name: session.user.name,
    email: '',
    phone: '',
    company: '',
    role: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void currentUserEmail().then(
      (email) => !cancelled && email && setValues((v) => (v.email ? v : { ...v, email })),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = trialRequestSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setSending(true);
    try {
      onActivated(
        await api<TrialStatusView>('/app/trial', {
          method: 'POST',
          body: JSON.stringify(parsed.data),
        }),
      );
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'VALIDATION_ERROR') {
        setErrors(fieldErrors(e.details));
        setError('Confira os campos destacados.');
      } else if (e instanceof ApiRequestError && e.status === 409) {
        onActivated({ state: 'unavailable', trialEndsAt: null });
      } else {
        setError(errorMessage(e, 'Não foi possível ativar o teste. Tente de novo.'));
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-5 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map(({ key, type, autoComplete }) => (
          <Field key={key} label={TRIAL_FIELD_LABELS[key]}>
            <input
              type={type}
              autoComplete={autoComplete}
              value={values[key]}
              onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
              aria-invalid={errors[key] ? true : undefined}
              className={`${inputClass} ${errors[key] ? 'border-red-400' : ''}`}
              maxLength={200}
              required
            />
            {errors[key] && <span className="mt-1 block text-xs text-red-600">{errors[key]}</span>}
          </Field>
        ))}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={sending} className={buttonClass()}>
          {sending && <Spinner className="size-4" />}
          Ativar teste grátis
        </button>
        <p className="text-xs text-zinc-500">
          Os dados ficam com a CRMThink para acompanhar o seu teste.
        </p>
      </div>
    </form>
  );
}

/**
 * Créditos e plano. Por enquanto só o trial por cadastro (tarefa 12.4); saldo, planos e checkout
 * entram nas tarefas 11.7 e 12.11.
 */
export default function PlanPage() {
  const { session, api } = useAppSession();
  const [status, setStatus] = useState<TrialStatusView | null>(null);
  const [summary, setSummary] = useState<CreditSummaryView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api<TrialStatusView>('/app/trial'), [api]);
  const loadSummary = useCallback(() => api<CreditSummaryView>('/app/credits'), [api]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([load(), loadSummary()])
      .then(([s, credits]) => {
        if (cancelled) return;
        setStatus(s);
        setSummary(credits);
      })
      .catch((e: unknown) => !cancelled && setError(errorMessage(e, 'Não foi possível carregar.')));
    return () => {
      cancelled = true;
    };
  }, [load, loadSummary]);

  // Trial confirmado: os 500 créditos já estão no saldo.
  useEffect(() => {
    if (status?.state !== 'trialing') return;
    loadSummary()
      .then(setSummary)
      .catch(() => undefined);
  }, [status?.state, loadSummary]);

  const paid =
    summary?.subscription?.status === 'active' || summary?.subscription?.status === 'past_due';

  // Ativação em andamento: consulta até o `subscription.trial_started` chegar ao backend.
  useEffect(() => {
    if (status?.state !== 'activating') return;
    const timer = setInterval(() => {
      load()
        .then(setStatus)
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [status?.state, load]);

  return (
    <>
      <PageHeader
        title="Créditos e plano"
        description="Saldo, consumo dos agentes e teste grátis do app."
      />
      {error && <Alert tone="error">{error}</Alert>}
      {(!status || !summary) && !error && <Loading />}

      {status?.state === 'available' && (
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <SparkIcon className="mt-0.5 size-6 shrink-0 text-brand-600" />
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">Teste grátis por 14 dias</h2>
              <p className="mt-1 text-sm text-zinc-600">
                Ganhe 500 créditos para seus agentes atenderem no Bitrix24, sem cartão de crédito.
              </p>
            </div>
          </div>
          {session.canManage ? (
            <TrialForm onActivated={setStatus} />
          ) : (
            <Alert tone="warning" className="mt-5">
              Somente o administrador do app pode ativar o teste grátis.
            </Alert>
          )}
        </Card>
      )}

      {status?.state === 'activating' && (
        <Card className="flex items-center gap-3 p-6">
          <Spinner />
          <div>
            <p className="font-medium text-zinc-900">Ativando seu teste grátis…</p>
            <p className="text-sm text-zinc-500">
              Os créditos aparecem em instantes. Você pode continuar usando o app.
            </p>
          </div>
        </Card>
      )}

      {status?.state === 'unavailable' && summary && !paid && (
        <Card className="flex items-start gap-3 p-6">
          <CheckIcon className="mt-0.5 size-5 shrink-0 text-zinc-400" />
          <p className="text-sm text-zinc-600">
            O teste grátis já foi utilizado neste portal. A contratação de planos pelo app chega em
            breve; enquanto isso, fale com a CRMThink.
          </p>
        </Card>
      )}

      {status && summary && (
        <div className="mt-8 space-y-8">
          <BalanceSection summary={summary} />
          <UsageSection cycleStart={summary.cycleStart} />
          <EntriesSection />
        </div>
      )}
    </>
  );
}
