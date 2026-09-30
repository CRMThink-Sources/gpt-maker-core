'use client';

import type { AgentView, AvailableModel, UpdateAgentInput } from '@gptmaker/contracts';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, use, useEffect, useState } from 'react';
import { agentStatus, errorMessage } from '@/lib/agents';
import { useAppSession } from '../../session-provider';
import { AgentForm, type AgentFormValues, initialValues } from '../agent-form';
import { StatusBadge } from '../status-badge';

const TEXTS = ['avatarUrl', 'behavior', 'jobName', 'jobSite', 'jobDescription'] as const;

/** Só o que mudou; texto apagado vai como `null` para limpar no servidor. */
function updateBody(values: AgentFormValues, agent: AgentView): UpdateAgentInput {
  const body: UpdateAgentInput = {};
  const name = values.name.trim();
  if (name !== agent.name) body.name = name;
  if (values.type !== agent.type) body.type = values.type;
  if (values.communicationType !== agent.communicationType) {
    body.communicationType = values.communicationType;
  }
  for (const key of TEXTS) {
    const value = values[key].trim() || null;
    if (value !== agent[key]) body[key] = value;
  }
  if (values.modelId !== agent.model.id) body.modelId = values.modelId;
  const settings = Object.fromEntries(
    Object.entries(values.settings).filter(
      ([key, value]) =>
        value !== undefined && value !== agent.settings[key as keyof AgentView['settings']],
    ),
  );
  if (Object.keys(settings).length) body.settings = settings;
  return body;
}

function Notice() {
  const created = useSearchParams().get('created');
  if (!created) return null;
  return (
    <p className="mt-4 rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900">
      Agente criado. Ajuste o atendimento abaixo, se quiser.
    </p>
  );
}

export default function AgentPage({ params }: PageProps<'/app/agents/[id]'>) {
  const { id } = use(params);
  const { session, api } = useAppSession();
  const [agent, setAgent] = useState<AgentView | null>(null);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // Remonta o formulário com os valores salvos.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<AgentView>(`/app/agents/${encodeURIComponent(id)}`),
      api<{ models: AvailableModel[] }>('/app/models'),
    ])
      .then(([row, list]) => {
        if (cancelled) return;
        setAgent(row);
        setModels(list.models);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(errorMessage(e, 'Não foi possível carregar o agente.'));
      });
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  async function save(values: AgentFormValues) {
    if (!agent) return;
    setError(null);
    setSaved(null);
    const body = updateBody(values, agent);
    if (Object.keys(body).length === 0) {
      setSaved('Nada para salvar: nenhum campo foi alterado.');
      return;
    }
    try {
      const updated = await api<AgentView>(`/app/agents/${agent.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setAgent(updated);
      setVersion((v) => v + 1);
      setSaved('Alterações salvas.');
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível salvar. Tente de novo.'));
    }
  }

  const readOnly = !session.canManage || agent?.status === 'OUT_OF_SYNC';

  return (
    <section className="max-w-2xl">
      <Link href="/app" className="text-sm text-violet-700 underline">
        Voltar
      </Link>

      {loadError ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {loadError}
        </p>
      ) : !agent ? (
        <p className="mt-4 text-sm text-zinc-500">Carregando…</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{agent.name}</h1>
            <StatusBadge {...agentStatus(agent)} />
          </div>
          <Suspense>
            <Notice />
          </Suspense>
          {agent.status === 'OUT_OF_SYNC' && (
            <p className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              O agente não foi encontrado no GPTMaker e não pode ser editado. Fale com o suporte.
            </p>
          )}
          {!session.canManage && (
            <p className="mt-4 text-sm text-zinc-600">
              Você pode consultar este agente. Para alterá-lo, peça acesso a um administrador.
            </p>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className="mt-4 text-sm text-green-800">
              {saved}
            </p>
          )}
          <AgentForm
            key={version}
            initial={initialValues(agent, models)}
            models={models}
            currentModel={agent.model}
            withSettings
            readOnly={readOnly}
            submitLabel="Salvar alterações"
            onSubmit={save}
          />
        </>
      )}
    </section>
  );
}
