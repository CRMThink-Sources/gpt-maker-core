'use client';

import {
  type AdminModelCostChange,
  type AdminModelView,
  createModelSchema,
  updateModelSchema,
} from '@gptmaker/contracts';
import { useCallback, useEffect, useState } from 'react';
import { PlusIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Card, Loading, PageHeader, Spinner } from '@/components/ui';
import { ApiRequestError } from '@/lib/platform-session';
import { Field, inputClass } from '../../app/agents/agent-fields';
import { useAdmin, useOperator } from '../admin-provider';

function message(e: unknown, fallback: string): string {
  return e instanceof ApiRequestError && !e.code.startsWith('HTTP_') ? e.message : fallback;
}

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Criação e edição. O código só é informado na criação (agentes e ledger o referenciam). */
function ModelForm({
  model,
  suggestion,
  onClose,
  onSaved,
}: {
  model: AdminModelView | null;
  suggestion?: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useAdmin();
  const [code, setCode] = useState(model?.code ?? '');
  const [displayName, setDisplayName] = useState(model?.displayName ?? '');
  const [description, setDescription] = useState(model?.description ?? '');
  const [cost, setCost] = useState<number | null>(suggestion ?? model?.creditsPerResponse ?? null);
  const [confirmUnknown, setConfirmUnknown] = useState(false);
  const [unknownCode, setUnknownCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    const parsed = model
      ? updateModelSchema.safeParse({
          displayName,
          description: description.trim() ? description : null,
          creditsPerResponse: cost,
        })
      : createModelSchema.safeParse({
          code: code.toUpperCase(),
          displayName,
          description: description.trim() ? description : null,
          creditsPerResponse: cost,
          confirmUnknownCode: confirmUnknown,
        });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
      return;
    }
    setBusy(true);
    try {
      await api(model ? `/admin/models/${model.id}` : '/admin/models', {
        method: model ? 'PATCH' : 'POST',
        body: JSON.stringify(parsed.data),
      });
      onSaved();
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'MODEL_CODE_UNKNOWN') setUnknownCode(true);
      setError(message(e, 'Não foi possível salvar.'));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={model ? `Editar ${model.displayName}` : 'Novo modelo'}
      description={
        model
          ? 'Mudanças de custo valem para as próximas respostas e ficam no histórico.'
          : 'O código é o valor de prefferModel no GPTMaker e não muda depois.'
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
      <div className="space-y-4">
        {!model && (
          <Field label="Código no GPTMaker" hint="Ex.: GPT_5_MINI, CLAUDE_4_5_HAIKU">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          </Field>
        )}
        <Field label="Nome">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Descrição (opcional)">
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field
          label="Créditos por resposta"
          hint={
            suggestion
              ? `Preenchido com a média real dos últimos 7 dias (${suggestion}).`
              : undefined
          }
        >
          <input
            type="number"
            min={1}
            value={cost ?? ''}
            onChange={(e) => setCost(e.target.value === '' ? null : Number(e.target.value))}
            className={inputClass}
          />
        </Field>
        {unknownCode && (
          <label className="flex items-start gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={confirmUnknown}
              onChange={(e) => setConfirmUnknown(e.target.checked)}
              className="mt-0.5"
            />
            Confirmo que o código existe no GPTMaker (modelo novo do provedor).
          </label>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

function CostHistory({ model, onClose }: { model: AdminModelView; onClose: () => void }) {
  const { api } = useAdmin();
  const [rows, setRows] = useState<AdminModelCostChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<AdminModelCostChange[]>(`/admin/models/${model.id}/history`)
      .then(setRows)
      .catch((e: unknown) => setError(message(e, 'Não foi possível carregar.')));
  }, [api, model.id]);

  return (
    <Modal
      title={`Histórico de custo: ${model.displayName}`}
      onRequestClose={onClose}
      footer={
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={buttonClass()}>
            Fechar
          </button>
        </div>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && (
        <p className="text-sm text-zinc-500">O custo nunca foi alterado.</p>
      )}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-zinc-100 text-sm">
          {rows.map((row, index) => (
            <li key={index} className="flex items-center justify-between py-2">
              <span className="text-zinc-900">
                {row.previousCost} → <strong>{row.newCost}</strong> créditos
              </span>
              <span className="text-xs text-zinc-500">
                {row.changedBy} · {dateTime(row.changedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function RemoveModel({
  model,
  models,
  onClose,
  onDone,
}: {
  model: AdminModelView;
  models: AdminModelView[];
  onClose: () => void;
  onDone: (migrated: number) => void;
}) {
  const { api } = useAdmin();
  const options = models.filter((m) => m.active && m.id !== model.id);
  const [replacement, setReplacement] = useState(options.find((m) => m.isDefault)?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const { migratedAgents } = await api<{ migratedAgents: number }>(
        `/admin/models/${model.id}/remove`,
        {
          method: 'POST',
          body: JSON.stringify(model.agentsUsing ? { replacementModelId: replacement } : {}),
        },
      );
      onDone(migratedAgents);
    } catch (e) {
      setError(message(e, 'Não foi possível remover.'));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Remover ${model.displayName}`}
      description="O modelo sai do catálogo; o histórico de débitos continua com o código."
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
            onClick={() => void remove()}
            disabled={busy}
            className={buttonClass('danger')}
          >
            {busy && <Spinner className="size-4" />}
            Remover
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {model.agentsUsing > 0 ? (
          <Field
            label="Substituto"
            hint={`${model.agentsUsing} agente(s) usam este modelo e passam para o substituto, no GPTMaker também.`}
          >
            <select
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              className={inputClass}
            >
              {options.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({m.creditsPerResponse}/resposta)
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <p className="text-sm text-zinc-600">Nenhum agente usa este modelo.</p>
        )}
        {model.plansAllowing > 0 && (
          <p className="text-sm text-zinc-600">
            Ele também sai da lista de {model.plansAllowing} plano(s).
          </p>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

/** Catálogo de modelos com custo, uso e média real da reconciliação (15.3, 14.3). */
export default function AdminModelsPage() {
  const { api } = useAdmin();
  const operator = useOperator();
  const isAdmin = operator.role === 'ADMIN';
  const [models, setModels] = useState<AdminModelView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: 'create' }
    | { kind: 'edit'; model: AdminModelView; suggestion?: number | null }
    | { kind: 'history'; model: AdminModelView }
    | { kind: 'remove'; model: AdminModelView }
    | null
  >(null);

  const load = useCallback(() => api<AdminModelView[]>('/admin/models'), [api]);
  const reload = useCallback(() => {
    void load()
      .then(setModels)
      .catch((e: unknown) => setError(message(e, 'Não foi possível carregar.')));
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((list) => !cancelled && setModels(list))
      .catch((e: unknown) => !cancelled && setError(message(e, 'Não foi possível carregar.')));
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function run(id: string, path: string) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await api(`/admin/models/${id}/${path}`, { method: 'POST' });
      setModels(await load());
    } catch (e) {
      setError(message(e, 'Não foi possível concluir.'));
    } finally {
      setBusyId(null);
    }
  }

  const stale = models?.filter((m) => m.insight.stale) ?? [];

  return (
    <>
      <PageHeader
        title="Modelos de IA"
        description="Custo em créditos por resposta, uso e média real cobrada pelo GPTMaker (últimos 30 dias)."
        actions={
          isAdmin && (
            <button
              type="button"
              onClick={() => setDialog({ kind: 'create' })}
              className={buttonClass()}
            >
              <PlusIcon className="size-4" />
              Novo modelo
            </button>
          )
        }
      />
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      )}
      {stale.length > 0 && (
        <Alert tone="warning" className="mb-4">
          {stale.length === 1 ? 'Um modelo está' : `${stale.length} modelos estão`} com o custo
          defasado: a média real ficou fora do cadastrado por 7 dias seguidos. Veja a sugestão na
          coluna Média real.
        </Alert>
      )}
      {!models && !error && <Loading />}
      {models && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-4xl text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="px-4 py-2.5 font-medium">Modelo</th>
                <th className="px-4 py-2.5 text-right font-medium">Custo</th>
                <th className="px-4 py-2.5 font-medium">Média real (30 dias)</th>
                <th className="px-4 py-2.5 font-medium">Uso</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id} className="border-b border-zinc-100 align-top last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-zinc-900">{m.displayName}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <code className="text-xs text-zinc-400">{m.code}</code>
                      {m.isDefault && <Badge tone="brand">Padrão</Badge>}
                      {!m.active && <Badge tone="zinc">Inativo</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-900">
                    {m.creditsPerResponse}
                  </td>
                  <td className="px-4 py-3">
                    {m.insight.average === null ? (
                      <span className="text-zinc-400">sem respostas</span>
                    ) : (
                      <>
                        <span className="tabular-nums text-zinc-900">
                          {m.insight.average.toLocaleString('pt-BR')}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {' '}
                          · {m.insight.responses.toLocaleString('pt-BR')} respostas
                        </span>
                        {m.insight.stale && m.insight.suggestion !== null && (
                          <div className="mt-1">
                            <Badge tone="amber">Defasado: sugerido {m.insight.suggestion}</Badge>
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-600">
                    {m.agentsUsing} agente(s) · {m.plansAllowing} plano(s)
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1">
                      {busyId === m.id && <Spinner className="size-4" />}
                      <button
                        type="button"
                        onClick={() => setDialog({ kind: 'history', model: m })}
                        className={buttonClass('ghost', 'sm')}
                      >
                        Histórico
                      </button>
                      {isAdmin && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setDialog({
                                kind: 'edit',
                                model: m,
                                suggestion: m.insight.stale ? m.insight.suggestion : undefined,
                              })
                            }
                            className={buttonClass('ghost', 'sm')}
                          >
                            {m.insight.stale ? 'Aplicar sugestão' : 'Editar'}
                          </button>
                          {!m.isDefault && m.active && (
                            <button
                              type="button"
                              disabled={busyId === m.id}
                              onClick={() => void run(m.id, 'default')}
                              className={buttonClass('ghost', 'sm')}
                            >
                              Tornar padrão
                            </button>
                          )}
                          {!m.isDefault && (
                            <button
                              type="button"
                              disabled={busyId === m.id}
                              onClick={() => void run(m.id, m.active ? 'deactivate' : 'activate')}
                              className={buttonClass('ghost', 'sm')}
                            >
                              {m.active ? 'Inativar' : 'Ativar'}
                            </button>
                          )}
                          {!m.isDefault && (
                            <button
                              type="button"
                              onClick={() => setDialog({ kind: 'remove', model: m })}
                              className={buttonClass('ghost-danger', 'sm')}
                            >
                              Remover
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {dialog?.kind === 'create' && (
        <ModelForm
          model={null}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
      {dialog?.kind === 'edit' && (
        <ModelForm
          model={dialog.model}
          suggestion={dialog.suggestion}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
      {dialog?.kind === 'history' && (
        <CostHistory model={dialog.model} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'remove' && models && (
        <RemoveModel
          model={dialog.model}
          models={models}
          onClose={() => setDialog(null)}
          onDone={(migrated) => {
            setDialog(null);
            setNotice(
              migrated
                ? `Modelo removido; ${migrated} agente(s) migrados para o substituto.`
                : 'Modelo removido.',
            );
            reload();
          }}
        />
      )}
    </>
  );
}
