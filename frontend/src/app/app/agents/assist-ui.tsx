'use client';

import {
  type AiKeyView,
  assistConfigured,
  assistFields,
  type AssistInput,
  type AssistResult,
  EXPECTATION_MAX,
  EXPECTATION_MIN,
  type FunctionAnswers,
  type FunctionAnswerValue,
  type FunctionTemplateContent,
} from '@gptmaker/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { Alert, buttonClass, Card } from '@/components/ui';
import { inputClass } from './agent-fields';
import { useFunctionAssist } from './use-function-assist';
import type { Api } from './use-function-review';

/** Como o formulário chega à ajuda: a API da tela da função e o estado da chave de IA. */
export interface FormAssist {
  api: Api;
  /** Endereço completo da chamada: por agente na tela da função, por código na criação. */
  endpoint: string;
  aiKey?: AiKeyView | null;
}

type Draft = AssistResult['fields'][number] & { label: string };

const MARKER = /\[preencher:[^\]]*\]/g;

/** O rascunho é só marcadores `[preencher: …]`: a IA não tinha o que dizer. */
export function onlyMarkers(value: FunctionAnswerValue): boolean {
  const texts = Array.isArray(value) ? value : [value];
  return texts.every(
    (item) => typeof item === 'string' && !/[\p{L}\p{N}]/u.test(item.replace(MARKER, '')),
  );
}

function Preview({ value }: { value: FunctionAnswerValue }) {
  if (Array.isArray(value)) {
    return (
      <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-800">
        {value.map((item, index) => (
          <li key={index}>{String(item)}</li>
        ))}
      </ol>
    );
  }
  return <p className="text-sm whitespace-pre-wrap text-zinc-800">{String(value)}</p>;
}

/**
 * Painel da ajuda da IA: o cliente conta do negócio, responde às perguntas de cada campo vazio e
 * revisa o rascunho. Nada é gravado sem "Aplicar"; campo preenchido no meio do caminho não é tocado.
 */
export function AssistPanel({
  form,
  answers,
  onApply,
  api,
  endpoint,
  aiKey,
  disabled,
}: {
  form: FunctionTemplateContent;
  answers: FunctionAnswers;
  onApply: (fieldId: string, value: FunctionAnswerValue) => void;
} & FormAssist & { disabled?: boolean }) {
  const eligible = assistFields(form, answers);
  const { run, state, error } = useFunctionAssist(api, endpoint);
  const [open, setOpen] = useState(false);
  const [about, setAbout] = useState('');
  const [interview, setInterview] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [credits, setCredits] = useState(0);
  const [applied, setApplied] = useState<string[]>([]);
  const aboutRef = useRef<HTMLTextAreaElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (open) aboutRef.current?.focus();
  }, [open]);

  // Sem a ajuda configurada o formulário fica exatamente como era.
  if (!assistConfigured(form)) return null;
  const nothingToHelp = eligible.length === 0 && !open;

  const loading = state === 'loading';
  const aboutOk = about.trim().length >= EXPECTATION_MIN;
  const platformKey = Boolean(aiKey && !aiKey.configured && aiKey.platformAvailable);
  const key = (fieldId: string, index: number) => `${fieldId}::${index}`;

  const generate = async () => {
    const fields = eligible.slice(0, 20);
    const input: AssistInput = {
      fieldIds: fields.map((field) => field.id),
      about: about.trim(),
      interview: fields
        .map((field) => ({
          fieldId: field.id,
          answers: field.assist!.questions.flatMap((question, index) => {
            const answer = (interview[key(field.id, index)] ?? '').trim();
            return answer ? [{ question, answer }] : [];
          }),
        }))
        .filter((entry) => entry.answers.length > 0),
      answers,
    };
    try {
      const result = await run(input);
      const labels = new Map(fields.map((field) => [field.id, field.label]));
      setDrafts(
        result.fields.map((item) => ({ ...item, label: labels.get(item.fieldId) ?? item.fieldId })),
      );
      setCredits(result.credits);
      setApplied([]);
    } catch {
      // `error` do hook mostra a mensagem; o botão "Gerar" tenta de novo.
    }
  };

  const close = () => {
    setOpen(false);
    openRef.current?.focus();
  };

  return (
    <div className="space-y-3">
      <button
        ref={openRef}
        type="button"
        className={buttonClass('secondary', 'sm')}
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled || nothingToHelp}
        onClick={() => (open ? close() : setOpen(true))}
      >
        Ajuda da IA
      </button>
      {nothingToHelp && (
        <p className="text-xs text-zinc-500">Todos os campos com ajuda já estão preenchidos</p>
      )}
      {open && (
        <Card className="space-y-4 p-4">
          <section
            onKeyDown={(event) => event.key === 'Escape' && close()}
            id={id}
            aria-label="Ajuda da IA"
            className="space-y-4"
          >
            <p className="text-sm text-zinc-600">
              A IA escreve um rascunho dos campos vazios com base no que você contar. Nada é gravado
              até você aplicar.
            </p>
            <label className="block">
              <span className="text-sm font-semibold text-zinc-900">
                Fale da empresa e do que o agente deve fazer
              </span>
              <textarea
                ref={aboutRef}
                className={inputClass}
                rows={3}
                value={about}
                maxLength={EXPECTATION_MAX}
                onChange={(event) => setAbout(event.target.value)}
              />
              <span
                className={`mt-1 block text-xs ${aboutOk ? 'text-zinc-400' : 'text-amber-600'}`}
              >
                {about.trim().length}/{EXPECTATION_MAX} (mínimo {EXPECTATION_MIN} caracteres)
              </span>
            </label>
            {eligible.map((field) => (
              <fieldset key={field.id} className="space-y-2">
                <legend className="text-sm font-semibold text-zinc-900">{field.label}</legend>
                {field.assist!.questions.map((question, index) => (
                  <label key={question} className="block">
                    <span className="text-xs font-medium text-zinc-700">{question}</span>
                    <input
                      className={inputClass}
                      value={interview[key(field.id, index)] ?? ''}
                      maxLength={1000}
                      // Enter aqui não pode enviar o formulário em volta (no assistente de criação
                      // seria "Ver prévia" e perderia a entrevista e os rascunhos).
                      onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()}
                      onChange={(event) =>
                        setInterview((prev) => ({
                          ...prev,
                          [key(field.id, index)]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
              </fieldset>
            ))}
            {platformKey && (
              <p className="text-xs text-zinc-500">
                A geração usa créditos da CRMThink; o valor gasto aparece depois de gerar.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonClass('primary', 'sm')}
                disabled={!aboutOk || loading || eligible.length === 0 || disabled}
                onClick={() => void generate()}
              >
                {loading ? 'Gerando…' : 'Gerar'}
              </button>
              <button type="button" className={buttonClass('ghost', 'sm')} onClick={close}>
                Fechar
              </button>
            </div>
            <div aria-live="polite" className="space-y-3">
              {loading && <p className="text-sm text-zinc-500">Escrevendo o rascunho…</p>}
              {state === 'error' && error && <Alert tone="error">{error}</Alert>}
              {state === 'done' && credits > 0 && (
                <p className="text-xs text-zinc-500">
                  Esta geração custou {credits} {credits === 1 ? 'crédito' : 'créditos'}.
                </p>
              )}
              {drafts.map((draft) => {
                const stillEmpty = eligible.some((field) => field.id === draft.fieldId);
                const done = applied.includes(draft.fieldId);
                const skeleton = onlyMarkers(draft.value);
                const reason = done
                  ? null
                  : !stillEmpty
                    ? 'O campo foi preenchido enquanto isso; não vou sobrescrever o que já está lá.'
                    : !draft.applicable
                      ? 'Este texto passa dos limites do campo e não pode ser aplicado.'
                      : null;
                return (
                  <div
                    key={draft.fieldId}
                    className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3"
                  >
                    <p className="text-xs font-semibold text-zinc-700">{draft.label}</p>
                    <Preview value={draft.value} />
                    {draft.markers > 0 && (
                      <p className="text-xs text-amber-700">
                        {draft.markers} {draft.markers === 1 ? 'trecho' : 'trechos'} [preencher: …]
                        para completar antes de publicar.
                      </p>
                    )}
                    {skeleton && (
                      <Alert tone="warning">
                        A IA não tinha informação suficiente: este texto é apenas um esqueleto.
                        Complete os trechos [preencher: …] antes de publicar, porque a publicação
                        fica bloqueada enquanto houver algum.
                      </Alert>
                    )}
                    {reason && <p className="text-xs text-zinc-500">{reason}</p>}
                    {done ? (
                      <p className="text-xs font-medium text-emerald-700">Aplicado</p>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={buttonClass('primary', 'sm')}
                          disabled={Boolean(reason) || disabled}
                          onClick={() => {
                            if (!eligible.some((field) => field.id === draft.fieldId)) return;
                            onApply(draft.fieldId, draft.value);
                            setApplied((prev) => [...prev, draft.fieldId]);
                          }}
                        >
                          Aplicar
                        </button>
                        <button
                          type="button"
                          className={buttonClass('ghost', 'sm')}
                          onClick={() =>
                            setDrafts((prev) => prev.filter((d) => d.fieldId !== draft.fieldId))
                          }
                        >
                          Descartar
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </Card>
      )}
    </div>
  );
}
