'use client';

import type { AgentView, AvailableModel, UpdateAgentInput } from '@gptmaker/contracts';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Alert, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/agents';
import { useAppSession } from '../../session-provider';
import { type AgentFormValues, initialValues } from '../agent-fields';
import { AgentForm } from '../agent-form';
import { useAgent } from './agent-context';

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
      Agente criado e já ativo. Ajuste o atendimento abaixo e, na aba Treinamentos, ensine o que ele
      precisa saber.
    </Alert>
  );
}

/** Aba Configurações: dados, modelo e regras de atendimento do agente. */
export default function AgentSettingsPage() {
  const { session, api } = useAppSession();
  const { agent, setAgent } = useAgent();
  const [models, setModels] = useState<AvailableModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // Remonta o formulário com os valores salvos.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<{ models: AvailableModel[] }>('/app/models')
      .then(({ models: list }) => !cancelled && setModels(list))
      .catch(
        (e: unknown) =>
          !cancelled && setError(errorMessage(e, 'Não foi possível carregar os modelos.')),
      );
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function save(values: AgentFormValues) {
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

  return (
    <>
      <Suspense>
        <Notice />
      </Suspense>
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
      {models === null ? (
        !error && <Loading />
      ) : (
        <AgentForm
          key={version}
          initial={initialValues(agent, models)}
          models={models}
          currentModel={agent.model}
          readOnly={!session.canManage || agent.status === 'OUT_OF_SYNC'}
          onSubmit={save}
        />
      )}
    </>
  );
}
