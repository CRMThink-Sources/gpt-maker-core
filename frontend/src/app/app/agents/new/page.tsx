'use client';

import type { AgentView, AvailableModel, CreateAgentInput } from '@gptmaker/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/agents';
import { useAppSession } from '../../session-provider';
import { AgentForm, type AgentFormValues, initialValues } from '../agent-form';

const optional = (value: string) => value.trim() || undefined;

function createBody(values: AgentFormValues): CreateAgentInput {
  return {
    name: values.name.trim(),
    avatarUrl: optional(values.avatarUrl),
    behavior: optional(values.behavior),
    type: values.type,
    communicationType: values.communicationType,
    jobName: optional(values.jobName),
    jobSite: optional(values.jobSite),
    jobDescription: optional(values.jobDescription),
    modelId: values.modelId || undefined,
  };
}

export default function NewAgentPage() {
  const { session, api } = useAppSession();
  const router = useRouter();
  const [models, setModels] = useState<AvailableModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  async function create(values: AgentFormValues) {
    setError(null);
    try {
      const agent = await api<AgentView>('/app/agents', {
        method: 'POST',
        body: JSON.stringify(createBody(values)),
      });
      router.push(`/app/agents/${agent.id}?created=1`);
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível criar o agente. Tente de novo.'));
    }
  }

  return (
    <section className="max-w-2xl">
      <Link href="/app" className="text-sm text-violet-700 underline">
        Voltar
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Novo agente</h1>

      {!session.canManage ? (
        <p className="mt-4 text-sm text-zinc-600">
          Você não tem permissão para criar agentes. Peça acesso a um administrador do portal.
        </p>
      ) : (
        <>
          {error && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              {error}
            </p>
          )}
          {models === null ? (
            !error && <p className="mt-4 text-sm text-zinc-500">Carregando…</p>
          ) : (
            <AgentForm
              initial={initialValues(undefined, models)}
              models={models}
              withSettings={false}
              readOnly={false}
              submitLabel="Criar agente"
              onSubmit={create}
            />
          )}
        </>
      )}
    </section>
  );
}
