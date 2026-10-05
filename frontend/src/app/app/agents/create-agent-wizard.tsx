'use client';

import type { AgentView, AvailableModel, CreateAgentInput } from '@gptmaker/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from '@/components/modal';
import { Stepper } from '@/components/stepper';
import { Alert, Avatar, buttonClass, Loading } from '@/components/ui';
import { AGENT_TYPES, COMMUNICATION_TYPES, credits, errorMessage } from '@/lib/agents';
import { useAppSession } from '../session-provider';
import {
  type AgentFormValues,
  CompanyFields,
  IdentityFields,
  initialValues,
  ModelFields,
} from './agent-fields';

const STEPS = [
  { title: 'Identidade', description: 'Quem é o agente e como ele se apresenta.' },
  { title: 'Empresa', description: 'O contexto do seu negócio, para o agente falar por você.' },
  { title: 'Modelo de IA', description: 'O modelo define a qualidade e o custo de cada resposta.' },
] as const;

const optional = (value: string) => value.trim() || undefined;

function createBody(values: AgentFormValues): CreateAgentInput {
  return {
    name: values.name.trim(),
    avatarUrl: optional(values.avatarUrl),
    behavior: values.behavior.trim(),
    type: values.type,
    communicationType: values.communicationType,
    jobName: optional(values.jobName),
    jobSite: optional(values.jobSite),
    jobDescription: values.jobDescription.trim(),
    modelId: values.modelId || undefined,
  };
}

/** O que o usuário digitou nos passos (modelo escolhido não conta: ele vem pré-selecionado). */
function hasTyped(values: AgentFormValues): boolean {
  const texts = [
    values.name,
    values.avatarUrl,
    values.behavior,
    values.jobName,
    values.jobSite,
    values.jobDescription,
  ];
  return texts.some((text) => text.trim() !== '');
}

function Summary({ values }: { values: AgentFormValues }) {
  return (
    <div className="mb-5 flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <Avatar name={values.name} src={values.avatarUrl || null} />
      <div className="min-w-0 text-sm">
        <p className="truncate font-medium text-zinc-900">{values.name}</p>
        <p className="truncate text-xs text-zinc-500">
          {AGENT_TYPES[values.type]} · tom{' '}
          {COMMUNICATION_TYPES[values.communicationType].toLowerCase()}
          {values.jobName.trim() && ` · ${values.jobName.trim()}`}
        </p>
      </div>
    </div>
  );
}

/** Criação de agente em passos, num modal sobre a lista. */
export function CreateAgentWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (agent: AgentView) => void;
}) {
  const { api } = useAppSession();
  const [models, setModels] = useState<AvailableModel[] | null>(null);
  const [values, setValues] = useState<AgentFormValues | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ models: AvailableModel[] }>('/app/models')
      .then(({ models: list }) => {
        if (cancelled) return;
        setModels(list);
        setValues(initialValues(undefined, list));
      })
      .catch(
        (e: unknown) =>
          !cancelled && setError(errorMessage(e, 'Não foi possível carregar os modelos.')),
      );
    return () => {
      cancelled = true;
    };
  }, [api]);

  const set = <K extends keyof AgentFormValues>(key: K, value: AgentFormValues[K]) =>
    setValues((current) => (current ? { ...current, [key]: value } : current));

  function requestClose() {
    if (creating) return;
    if (values && hasTyped(values)) setConfirmingClose(true);
    else onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!values) return;
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }
    setError(null);
    setCreating(true);
    try {
      onCreated(
        await api<AgentView>('/app/agents', {
          method: 'POST',
          body: JSON.stringify(createBody(values)),
        }),
      );
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível criar o agente. Tente de novo.'));
      setCreating(false);
    }
  }

  const last = step === STEPS.length - 1;
  const footer = confirmingClose ? (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-sm text-zinc-700">Descartar o que foi preenchido?</span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setConfirmingClose(false)}
          className={buttonClass('secondary')}
        >
          Continuar editando
        </button>
        <button type="button" onClick={onClose} className={buttonClass('danger')}>
          Descartar
        </button>
      </div>
    </div>
  ) : (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-zinc-500">
        Passo {step + 1} de {STEPS.length}
      </span>
      <div className="flex gap-2">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            disabled={creating}
            className={buttonClass('secondary')}
          >
            Voltar
          </button>
        ) : (
          <button type="button" onClick={requestClose} className={buttonClass('secondary')}>
            Cancelar
          </button>
        )}
        <button
          type="submit"
          form="create-agent-step"
          disabled={!values || creating || (last && !values.modelId)}
          className={buttonClass('primary')}
        >
          {creating ? 'Criando…' : last ? 'Criar agente' : 'Avançar'}
        </button>
      </div>
    </div>
  );

  return (
    <Modal
      title="Novo agente"
      description={STEPS[step]!.description}
      header={<Stepper steps={STEPS} current={step} />}
      footer={footer}
      onRequestClose={requestClose}
    >
      {error && (
        <Alert tone="error" className="mb-5">
          {error}
        </Alert>
      )}
      {!values || !models ? (
        !error && <Loading />
      ) : (
        // Um form por passo: "Avançar" valida só os campos visíveis (obrigatório, URL).
        <form id="create-agent-step" key={step} onSubmit={submit}>
          <fieldset disabled={creating} className="space-y-5">
            {step === 0 && <IdentityFields values={values} set={set} autoFocus />}
            {step === 1 && <CompanyFields values={values} set={set} autoFocus />}
            {step === 2 && (
              <>
                <Summary values={values} />
                <ModelFields values={values} set={set} models={models} />
                {models.length > 0 && (
                  <p className="text-xs text-zinc-500">
                    Você pode trocar o modelo depois, na página do agente.
                    {models.length === 1 &&
                      ` Seu plano libera só este modelo (${credits(models[0]!.creditsPerResponse)}).`}
                  </p>
                )}
              </>
            )}
          </fieldset>
        </form>
      )}
    </Modal>
  );
}
