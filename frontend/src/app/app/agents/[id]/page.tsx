'use client';

import type { AgentView, AvailableModel, UpdateAgentInput } from '@gptmaker/contracts';
import { useSearchParams } from 'next/navigation';
import { Suspense, use, useEffect, useState } from 'react';
import { Alert, Avatar, Badge, Loading, PageHeader } from '@/components/ui';
import { AGENT_TYPES, agentStatus, errorMessage } from '@/lib/agents';
import { useAppSession } from '../../session-provider';
import { type AgentFormValues, initialValues } from '../agent-fields';
import { AgentForm } from '../agent-form';

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
    <Alert tone="success" className="mb-6">
      Agente criado e já ativo. Ajuste o atendimento abaixo, se quiser.
    </Alert>
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const readOnly = !session.canManage || agent?.status === 'OUT_OF_SYNC';

  return (
    <>
      {loadError ? (
        <>
          <PageHeader title="Agente" back={{ href: '/app', label: 'Agentes' }} />
          <Alert tone="error">{loadError}</Alert>
        </>
      ) : !agent ? (
        <Loading />
      ) : (
        <>
          <PageHeader
            back={{ href: '/app', label: 'Agentes' }}
            title={
              <span className="flex items-center gap-3">
                <Avatar name={agent.name} src={agent.avatarUrl} />
                {agent.name}
              </span>
            }
            aside={<Badge tone={agentStatus(agent).tone}>{agentStatus(agent).label}</Badge>}
            description={`${AGENT_TYPES[agent.type]} · criado em ${new Date(agent.createdAt).toLocaleDateString('pt-BR')}`}
          />
          <Suspense>
            <Notice />
          </Suspense>
          {agent.status === 'OUT_OF_SYNC' && (
            <Alert tone="warning" className="mb-6">
              O agente não foi encontrado no GPTMaker e não pode ser editado. Fale com o suporte.
            </Alert>
          )}
          {!session.canManage && (
            <Alert tone="warning" className="mb-6">
              Você pode consultar este agente. Para alterá-lo, peça acesso a um administrador.
            </Alert>
          )}
          {error && (
            <Alert tone="error" className="mb-6">
              {error}
            </Alert>
          )}
          {saved && (
            <Alert tone="success" className="mb-6">
              {saved}
            </Alert>
          )}
          <AgentForm
            key={version}
            initial={initialValues(agent, models)}
            models={models}
            currentModel={agent.model}
            readOnly={readOnly}
            cancelHref="/app"
            onSubmit={save}
          />
        </>
      )}
    </>
  );
}
