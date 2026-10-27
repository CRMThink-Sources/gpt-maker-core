'use client';

import {
  type AgentFunctionView,
  type AgentView,
  type AnswerIssue,
  type AvailableModel,
  type CreateAgentInput,
  type FunctionAnswers,
  type FunctionPreview,
  type FunctionTemplateContent,
  validateFunctionAnswers,
} from '@gptmaker/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from '@/components/modal';
import { Stepper } from '@/components/stepper';
import { Alert, buttonClass, Loading } from '@/components/ui';
import { credits, errorMessage } from '@/lib/agents';
import { ApiRequestError } from '@/lib/platform-session';
import { useAppSession } from '../session-provider';
import { type AgentFormValues, IdentityFields, initialValues, ModelFields } from './agent-fields';
import { BehaviorMeter, FunctionForm } from './function-form';
import { FunctionPreviewView } from './function-preview';

const STEPS = [
  { title: 'Função', description: 'O que o agente vai fazer. Cada agente tem uma função.' },
  { title: 'Identidade', description: 'Como o agente se apresenta e qual modelo de IA usa.' },
  { title: 'Formulário', description: 'Conte sobre o seu negócio; o texto do agente é nosso.' },
  { title: 'Prévia', description: 'Confira o que será criado antes de confirmar.' },
] as const;

/** Problemas das respostas devolvidos pela API (`FUNCTION_ANSWERS_INVALID`). */
function issuesOf(error: unknown): AnswerIssue[] | null {
  if (!(error instanceof ApiRequestError) || error.code !== 'FUNCTION_ANSWERS_INVALID') return null;
  return (error.details as { issues?: AnswerIssue[] } | undefined)?.issues ?? null;
}

/** Criação de agente por função (design D6), num modal sobre a lista. */
export function CreateAgentWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (agent: AgentView) => void;
}) {
  const { api } = useAppSession();
  const [functions, setFunctions] = useState<AgentFunctionView[] | null>(null);
  const [models, setModels] = useState<AvailableModel[] | null>(null);
  const [values, setValues] = useState<AgentFormValues | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [form, setForm] = useState<FunctionTemplateContent | null>(null);
  const [answers, setAnswers] = useState<FunctionAnswers>({});
  const [issues, setIssues] = useState<AnswerIssue[]>([]);
  const [preview, setPreview] = useState<FunctionPreview | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<{ functions: AgentFunctionView[] }>('/app/agent-functions'),
      api<{ models: AvailableModel[] }>('/app/models'),
    ])
      .then(([fn, md]) => {
        if (cancelled) return;
        setFunctions(fn.functions);
        setModels(md.models);
        setValues(initialValues(undefined, md.models));
      })
      .catch(
        (e: unknown) =>
          !cancelled && setError(errorMessage(e, 'Não foi possível carregar as funções.')),
      );
    return () => {
      cancelled = true;
    };
  }, [api]);

  const set = <K extends keyof AgentFormValues>(key: K, value: AgentFormValues[K]) =>
    setValues((current) => (current ? { ...current, [key]: value } : current));

  async function choose(code: string) {
    if (code === chosen && form) return;
    setError(null);
    setBusy(true);
    try {
      const fn = await api<AgentFunctionView & { form: FunctionTemplateContent }>(
        `/app/agent-functions/${encodeURIComponent(code)}`,
      );
      setChosen(code);
      setForm(fn.form);
      setAnswers({});
      setIssues([]);
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível carregar o formulário da função.'));
    } finally {
      setBusy(false);
    }
  }

  function requestClose() {
    if (busy) return;
    if (chosen || values?.name.trim()) setConfirmingClose(true);
    else onClose();
  }

  function body(): CreateAgentInput {
    return {
      name: values!.name.trim(),
      avatarUrl: values!.avatarUrl.trim() || undefined,
      modelId: values!.modelId || undefined,
      functionCode: chosen!,
      answers,
    };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!values || !form || !chosen) {
      if (step === 0 && !chosen) setError('Escolha a função do agente.');
      return;
    }
    setError(null);
    if (step === 2) {
      // Valida aqui o mesmo que a API valida: o cliente vê o campo antes de ir à prévia.
      const result = validateFunctionAnswers(form, answers);
      setIssues(result.issues);
      if (result.issues.length) {
        setError('Revise os campos destacados no formulário.');
        return;
      }
      setBusy(true);
      try {
        setPreview(
          await api<FunctionPreview>('/app/agent-functions/preview', {
            method: 'POST',
            body: JSON.stringify({ functionCode: chosen, agentName: values.name, answers }),
          }),
        );
        setStep(3);
      } catch (e) {
        setError(errorMessage(e, 'Não foi possível montar a prévia.'));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    try {
      onCreated(
        await api<AgentView>('/app/agents', { method: 'POST', body: JSON.stringify(body()) }),
      );
    } catch (e) {
      const found = issuesOf(e);
      if (found) {
        setIssues(found);
        setStep(2);
      }
      setError(errorMessage(e, 'Não foi possível criar o agente. Tente de novo.'));
      setBusy(false);
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
            disabled={busy}
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
          disabled={
            !values ||
            busy ||
            (step === 0 && !chosen) ||
            (last && preview?.compiled.errors.length !== 0)
          }
          className={buttonClass('primary')}
        >
          {busy ? 'Aguarde…' : last ? 'Criar agente' : step === 2 ? 'Ver prévia' : 'Avançar'}
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
      {!values || !models || !functions ? (
        !error && <Loading />
      ) : (
        <form id="create-agent-step" key={step} onSubmit={submit}>
          <fieldset disabled={busy} className="space-y-5">
            {step === 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {functions.map((fn) => (
                  <button
                    key={fn.code}
                    type="button"
                    onClick={() => choose(fn.code)}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      chosen === fn.code
                        ? 'border-brand-500 bg-brand-50/50 ring-2 ring-brand-100'
                        : 'border-zinc-200 hover:border-zinc-300'
                    }`}
                  >
                    <span className="block text-sm font-semibold text-zinc-900">{fn.name}</span>
                    <span className="mt-1 block text-xs text-zinc-600">{fn.description}</span>
                  </button>
                ))}
                {functions.length === 0 && (
                  <Alert tone="warning">Nenhuma função disponível no momento.</Alert>
                )}
              </div>
            )}
            {step === 1 && (
              <>
                <IdentityFields values={values} set={set} autoFocus />
                <ModelFields values={values} set={set} models={models} />
                {models.length === 1 && (
                  <p className="text-xs text-zinc-500">
                    Seu plano libera só este modelo ({credits(models[0]!.creditsPerResponse)}).
                  </p>
                )}
              </>
            )}
            {step === 2 && form && (
              <>
                <BehaviorMeter form={form} answers={answers} agentName={values.name} />
                <FunctionForm form={form} answers={answers} onChange={setAnswers} issues={issues} />
              </>
            )}
            {step === 3 && preview && <FunctionPreviewView preview={preview} />}
          </fieldset>
        </form>
      )}
    </Modal>
  );
}
