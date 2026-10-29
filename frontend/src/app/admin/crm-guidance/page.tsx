'use client';

import {
  CRM_GUIDANCE_LABELS,
  CRM_GUIDANCE_MAX,
  type CrmGuidanceKey,
  type CrmGuidanceView,
  crmGuidanceInputSchema,
} from '@gptmaker/contracts';
import { useEffect, useState } from 'react';
import { Alert, Badge, buttonClass, Card, Loading, PageHeader, Spinner } from '@/components/ui';
import { ApiRequestError } from '@/lib/platform-session';
import { formatDateTime } from '@/lib/triggers';
import { inputClass } from '../../app/agents/agent-fields';
import { useAdmin, useOperator } from '../admin-provider';

/** Quando cada texto chega ao agente. */
const USAGE: Record<CrmGuidanceKey, string> = {
  cliente_identificado: 'Vai na resposta de "Consultar cliente no CRM" quando o cliente é achado.',
  negocios_do_cliente: 'Vai na resposta da ferramenta negocios_do_cliente.',
  escopo_dados: 'Somado ao fim das duas orientações acima: o que o agente tem e o que não tem.',
  cliente_nao_identificado: 'Resposta quando a conversa não está ligada a um cliente do CRM.',
};

function message(e: unknown, fallback: string): string {
  return e instanceof ApiRequestError && !e.code.startsWith('HTTP_') ? e.message : fallback;
}

/** Um texto: edição, contador, selo Editado/Padrão e restaurar o padrão. */
function GuidanceCard({
  item,
  canEdit,
  onSaved,
}: {
  item: CrmGuidanceView;
  canEdit: boolean;
  onSaved: (list: CrmGuidanceView[]) => void;
}) {
  const { api } = useAdmin();
  const [draft, setDraft] = useState(item.text);
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = `crm-guidance-${item.key}`;

  async function save() {
    const parsed = crmGuidanceInputSchema.safeParse({ text: draft });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revise o texto.');
      return;
    }
    setBusy('save');
    setError(null);
    try {
      onSaved(
        await api<CrmGuidanceView[]>(`/admin/crm-guidance/${item.key}`, {
          method: 'PUT',
          body: JSON.stringify(parsed.data),
        }),
      );
    } catch (e) {
      setError(message(e, 'Não foi possível salvar.'));
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setBusy('reset');
    setError(null);
    try {
      const list = await api<CrmGuidanceView[]>(`/admin/crm-guidance/${item.key}`, {
        method: 'DELETE',
      });
      setDraft(item.defaultText);
      onSaved(list);
    } catch (e) {
      setError(message(e, 'Não foi possível restaurar o padrão.'));
    } finally {
      setBusy(null);
    }
  }

  const changed = draft.trim() !== item.text;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label htmlFor={id} className="text-sm font-medium text-zinc-900">
            {CRM_GUIDANCE_LABELS[item.key]}
          </label>
          {item.edited ? <Badge tone="brand">Editado</Badge> : <Badge tone="zinc">Padrão</Badge>}
        </div>
        {item.edited && item.updatedAt && (
          <span className="text-xs text-zinc-400">
            {item.updatedBy ?? 'Operador'} em {formatDateTime(item.updatedAt)}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-zinc-500">{USAGE[item.key]}</p>
      <textarea
        id={id}
        className={`${inputClass} min-h-24`}
        maxLength={CRM_GUIDANCE_MAX}
        value={draft}
        readOnly={!canEdit}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-zinc-500">
          {draft.length}/{CRM_GUIDANCE_MAX}
        </span>
        {canEdit && (
          <div className="flex items-center gap-2">
            {item.edited && (
              <button
                type="button"
                onClick={() => void reset()}
                disabled={busy !== null}
                className={buttonClass('ghost', 'sm')}
              >
                {busy === 'reset' && <Spinner className="size-3.5" />}
                Restaurar padrão
              </button>
            )}
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy !== null || !changed}
              className={buttonClass('primary', 'sm')}
            >
              {busy === 'save' && <Spinner className="size-3.5" />}
              Salvar
            </button>
          </div>
        )}
      </div>
      {item.edited && (
        <details className="mt-3 text-xs text-zinc-500">
          <summary className="cursor-pointer">Ver o texto padrão</summary>
          <p className="mt-1.5 rounded-lg bg-zinc-50 p-3 text-zinc-600">{item.defaultText}</p>
        </details>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}

/** Orientações que as ferramentas do CRM enviam ao agente (spec agent-crm-tools). */
export default function AdminCrmGuidancePage() {
  const { api } = useAdmin();
  const operator = useOperator();
  const [list, setList] = useState<CrmGuidanceView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Remonta os cards depois de salvar (descarta rascunhos antigos).
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<CrmGuidanceView[]>('/admin/crm-guidance')
      .then((data) => !cancelled && setList(data))
      .catch((e: unknown) => !cancelled && setError(message(e, 'Não foi possível carregar.')));
    return () => {
      cancelled = true;
    };
  }, [api]);

  function onSaved(next: CrmGuidanceView[]) {
    setList(next);
    setVersion((v) => v + 1);
  }

  const text = (key: CrmGuidanceKey) => list?.find((item) => item.key === key)?.text ?? '';
  const canEdit = operator.role === 'ADMIN';

  return (
    <>
      <PageHeader
        title="Orientações do CRM"
        description="Textos fixos que as ferramentas do CRM enviam ao agente junto com os dados. Valem para todos os portais em até 1 minuto depois de salvos."
      />
      {error && <Alert tone="error">{error}</Alert>}
      {!list && !error && <Loading />}
      {list && (
        <div className="space-y-4">
          {!canEdit && (
            <Alert tone="warning">Você pode consultar. Só administradores editam.</Alert>
          )}
          {list.map((item) => (
            <GuidanceCard
              key={`${version}:${item.key}`}
              item={item}
              canEdit={canEdit}
              onSaved={onSaved}
            />
          ))}
          <Card className="p-5">
            <p className="text-sm font-medium text-zinc-900">Como o agente recebe</p>
            <p className="mt-0.5 text-xs text-zinc-500">Textos salvos, já montados.</p>
            <dl className="mt-3 space-y-3 text-xs">
              {(['cliente_identificado', 'negocios_do_cliente'] as const).map((key) => (
                <div key={key}>
                  <dt className="font-medium text-zinc-700">{CRM_GUIDANCE_LABELS[key]}</dt>
                  <dd className="mt-1 rounded-lg bg-zinc-50 p-3 font-mono text-zinc-700">
                    orientacao: {text(key)} {text('escopo_dados')}
                  </dd>
                </div>
              ))}
              <div>
                <dt className="font-medium text-zinc-700">
                  {CRM_GUIDANCE_LABELS.cliente_nao_identificado}
                </dt>
                <dd className="mt-1 rounded-lg bg-zinc-50 p-3 font-mono text-zinc-700">
                  mensagem: {text('cliente_nao_identificado')}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      )}
    </>
  );
}
