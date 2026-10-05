'use client';

import {
  type AdminPlanModel,
  type AdminPlansView,
  type AdminPlanView,
  updatePlanRightsSchema,
} from '@gptmaker/contracts';
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Card, Loading, PageHeader, Spinner } from '@/components/ui';
import { ApiRequestError } from '@/lib/platform-session';
import { Field, inputClass } from '../../app/agents/agent-fields';
import { useAdmin, useOperator } from '../admin-provider';

type PlansResponse = AdminPlansView & { platformError: boolean };

const INTERVALS = { monthly: 'mês', quarterly: 'trimestre', semiannual: 'semestre', yearly: 'ano' };

function price(plan: AdminPlanView): string {
  if (!plan.onPlatform) return '—';
  const value = (plan.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return plan.interval ? `${value}/${INTERVALS[plan.interval]}` : value;
}

function number(value: number | null): string {
  return value === null ? 'sem limite' : value.toLocaleString('pt-BR');
}

function message(e: unknown, fallback: string): string {
  return e instanceof ApiRequestError && !e.code.startsWith('HTTP_') ? e.message : fallback;
}

/** Campo numérico que aceita vazio (nulo). */
function NumberInput({
  value,
  onChange,
  placeholder,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      min={0}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className={inputClass}
    />
  );
}

function EditRights({
  plan,
  models,
  onClose,
  onSaved,
}: {
  plan: AdminPlanView;
  models: AdminPlanModel[];
  onClose: () => void;
  onSaved: (plan: AdminPlanView) => void;
}) {
  const { api } = useAdmin();
  const subscription = plan.type === 'subscription';
  const [active, setActive] = useState(plan.rights?.active ?? true);
  const [creditsPerCycle, setCreditsPerCycle] = useState<number | null>(
    plan.rights?.creditsPerCycle ?? (plan.trial ? 0 : null),
  );
  const [creditsPerPackage, setCreditsPerPackage] = useState<number | null>(
    plan.rights?.creditsPerPackage ?? null,
  );
  const [maxTrainings, setMaxTrainings] = useState<number | null>(
    plan.rights?.maxTrainings ?? null,
  );
  const [maxStorage, setMaxStorage] = useState<number | null>(
    plan.rights?.maxDocumentStorageMb ?? null,
  );
  const [allowed, setAllowed] = useState<Set<string>>(new Set(plan.rights?.allowedModelIds ?? []));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const parsed = updatePlanRightsSchema.safeParse({
      type: plan.type,
      active,
      creditsPerCycle: subscription ? creditsPerCycle : null,
      creditsPerPackage: subscription ? null : creditsPerPackage,
      maxTrainings: subscription ? maxTrainings : null,
      maxDocumentStorageMb: subscription ? maxStorage : null,
      allowedModelIds: subscription ? [...allowed] : [],
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api<AdminPlanView>(`/admin/plans/${plan.id}`, {
          method: 'PUT',
          body: JSON.stringify(parsed.data),
        }),
      );
    } catch (e) {
      setError(message(e, 'Não foi possível salvar.'));
      setBusy(false);
    }
  }

  const selectable = models.filter((model) => model.active && !model.isDefault);
  const defaultModel = models.find((model) => model.isDefault);

  return (
    <Modal
      title={`Direitos: ${plan.name}`}
      description={
        subscription
          ? 'Créditos valem para quem já assina a partir do próximo ciclo; modelos e limites, para as próximas escolhas.'
          : 'Créditos adicionais concedidos por pacote comprado.'
      }
      onRequestClose={() => !busy && onClose()}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={buttonClass('secondary')}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className={buttonClass()}
          >
            {busy && <Spinner className="size-4" />}
            Salvar
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span className="font-medium text-zinc-800">À venda no app</span>
          <span className="text-zinc-500">(desmarcado: some da tela de planos)</span>
        </label>

        {subscription ? (
          <>
            <Field
              label="Créditos por ciclo"
              hint={
                plan.trial
                  ? 'Plano de trial: os créditos do teste vêm da configuração do app (500).'
                  : undefined
              }
            >
              <NumberInput value={creditsPerCycle} onChange={setCreditsPerCycle} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Treinamentos por agente" hint="Vazio = sem limite">
                <NumberInput
                  value={maxTrainings}
                  onChange={setMaxTrainings}
                  placeholder="sem limite"
                />
              </Field>
              <Field label="Documentos (MB por agente)" hint="Vazio = sem limite">
                <NumberInput value={maxStorage} onChange={setMaxStorage} placeholder="sem limite" />
              </Field>
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-800">Modelos de IA permitidos</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {defaultModel ? `${defaultModel.displayName} (padrão) é sempre permitido. ` : ''}
                Agentes com modelo fora do plano passam para o padrão quando a assinatura muda.
              </p>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {selectable.map((model) => (
                  <label key={model.id} className="flex items-center gap-2 text-sm text-zinc-700">
                    <input
                      type="checkbox"
                      checked={allowed.has(model.id)}
                      onChange={(e) =>
                        setAllowed((current) => {
                          const next = new Set(current);
                          if (e.target.checked) next.add(model.id);
                          else next.delete(model.id);
                          return next;
                        })
                      }
                    />
                    {model.displayName}
                    <span className="text-xs text-zinc-400">
                      {model.creditsPerResponse}/resposta
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </>
        ) : (
          <Field label="Créditos do pacote">
            <NumberInput value={creditsPerPackage} onChange={setCreditsPerPackage} />
          </Field>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

/** Planos do SPA 1138 e os direitos que o app concede (15.2). */
export default function AdminPlansPage() {
  const { api } = useAdmin();
  const operator = useOperator();
  const [data, setData] = useState<PlansResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminPlanView | null>(null);

  const load = useCallback(() => api<PlansResponse>('/admin/plans'), [api]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((view) => !cancelled && setData(view))
      .catch((e: unknown) => !cancelled && setError(message(e, 'Não foi possível carregar.')));
    return () => {
      cancelled = true;
    };
  }, [load]);

  const modelName = (id: string) =>
    data?.models.find((model) => model.id === id)?.displayName ?? id;

  return (
    <>
      <PageHeader
        title="Planos"
        description="Preço e intervalo vêm do SPA de Planos; aqui ficam os créditos, modelos e limites que o app concede."
      />
      {error && <Alert tone="error">{error}</Alert>}
      {data?.platformError && (
        <Alert tone="warning" className="mb-4">
          A plataforma não respondeu: mostrando só os planos com direitos já cadastrados.
        </Alert>
      )}
      {!data && !error && <Loading />}
      {data && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-3xl text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="px-4 py-2.5 font-medium">Plano</th>
                <th className="px-4 py-2.5 font-medium">Preço</th>
                <th className="px-4 py-2.5 font-medium">Créditos</th>
                <th className="px-4 py-2.5 font-medium">Modelos e limites</th>
                <th className="px-4 py-2.5 text-right font-medium">Assinantes</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {data.plans.map((plan) => (
                <tr key={plan.id} className="border-b border-zinc-100 align-top last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-zinc-900">{plan.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <span className="text-xs text-zinc-400">#{plan.id}</span>
                      <Badge tone="zinc">
                        {plan.type === 'subscription' ? 'Assinatura' : 'Pacote'}
                      </Badge>
                      {plan.trial && <Badge tone="brand">Trial</Badge>}
                      {!plan.rights && <Badge tone="amber">Sem direitos: fora da venda</Badge>}
                      {plan.rights && !plan.rights.active && (
                        <Badge tone="zinc">Fora da venda</Badge>
                      )}
                      {!plan.onPlatform && <Badge tone="amber">Não está na plataforma</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-zinc-700">{price(plan)}</td>
                  <td className="px-4 py-3 text-zinc-700">
                    {!plan.rights
                      ? '—'
                      : plan.type === 'subscription'
                        ? `${number(plan.rights.creditsPerCycle)} por ciclo`
                        : `${number(plan.rights.creditsPerPackage)} por pacote`}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-600">
                    {plan.rights && plan.type === 'subscription' ? (
                      <>
                        <p>
                          {plan.rights.allowedModelIds.length
                            ? plan.rights.allowedModelIds.map(modelName).join(', ')
                            : 'Só o modelo padrão'}
                        </p>
                        <p className="mt-1 text-zinc-400">
                          Treinamentos: {number(plan.rights.maxTrainings)} · Documentos:{' '}
                          {plan.rights.maxDocumentStorageMb === null
                            ? 'sem limite'
                            : `${plan.rights.maxDocumentStorageMb} MB`}
                        </p>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                    {plan.subscribers}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {operator.role === 'ADMIN' && (
                      <button
                        type="button"
                        onClick={() => setEditing(plan)}
                        className={buttonClass(plan.rights ? 'ghost' : 'secondary', 'sm')}
                      >
                        {plan.rights ? 'Editar' : 'Cadastrar direitos'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {editing && data && (
        <EditRights
          plan={editing}
          models={data.models}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load().then(setData);
          }}
        />
      )}
    </>
  );
}
