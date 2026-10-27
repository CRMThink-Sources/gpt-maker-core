'use client';

import type {
  AgentFunctionConfigView,
  AgentView,
  AnswerIssue,
  FunctionAnswers,
  FunctionMode,
  FunctionPreview,
  FunctionPublishInput,
} from '@gptmaker/contracts';
import { FUNCTION_ADDITIONAL_INSTRUCTIONS_MAX, FUNCTION_BEHAVIOR_MAX } from '@gptmaker/contracts';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Card, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/agents';
import { ApiRequestError } from '@/lib/platform-session';
import { useAppSession } from '../../../session-provider';
import { useTransferAgents } from '../../use-transfer-agents';
import { Field, inputClass } from '../../agent-fields';
import { BehaviorMeter, FunctionForm, FunctionFormOutline } from '../../function-form';
import { BehaviorDiff, FunctionPreviewView } from '../../function-preview';
import { useAgent } from '../agent-context';

const MODES: Record<FunctionMode, string> = {
  SIMPLE: 'Simples',
  ADVANCED: 'Avançado',
  TAKEN_OVER: 'Controle assumido',
};

/** Pedido de troca de modo esperando confirmação; cada escolha vira um botão. */
type ModeRequest = {
  title: string;
  text: string;
  choices: Array<{ to: FunctionMode; label: string }>;
} | null;

function issuesOf(error: unknown): AnswerIssue[] | null {
  if (!(error instanceof ApiRequestError) || error.code !== 'FUNCTION_ANSWERS_INVALID') return null;
  return (error.details as { issues?: AnswerIssue[] } | undefined)?.issues ?? null;
}

function CreatedNotice() {
  const created = useSearchParams().get('created');
  if (!created) return null;
  return (
    <Alert tone="success">
      Agente criado e já ativo. A base de conhecimento e as ações estão sendo aplicadas; o status
      aparece abaixo.
    </Alert>
  );
}

/** Aba Função: formulário, modos e publicação (spec agent-function-configuration). */
export default function AgentFunctionPage() {
  const { session, api } = useAppSession();
  const { agent, setAgent } = useAgent();
  const transferAgents = useTransferAgents(agent.id);
  const [config, setConfig] = useState<AgentFunctionConfigView | null>(null);
  const [answers, setAnswers] = useState<FunctionAnswers>({});
  const [mode, setMode] = useState<FunctionMode>('SIMPLE');
  const [additional, setAdditional] = useState('');
  const [takenOver, setTakenOver] = useState('');
  const [issues, setIssues] = useState<AnswerIssue[]>([]);
  const [preview, setPreview] = useState<FunctionPreview | null>(null);
  const [modeRequest, setModeRequest] = useState<ModeRequest>(null);
  const [update, setUpdate] = useState<FunctionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const base = `/app/agents/${encodeURIComponent(agent.id)}`;
  const readOnly = !session.canManage || agent.status === 'OUT_OF_SYNC';

  /** Mostra a configuração; com `resetForm`, o formulário volta ao que está salvo. */
  const apply = useCallback((view: AgentFunctionConfigView, resetForm: boolean) => {
    setConfig(view);
    if (resetForm) {
      setUpdate(null);
      setAnswers(view.draftAnswers ?? view.answers);
      setMode(view.mode);
      setAdditional(view.additionalInstructions ?? '');
      setTakenOver(view.takenOverBehavior ?? '');
    }
  }, []);

  const load = useCallback(
    async (resetForm: boolean) => {
      const view = await api<AgentFunctionConfigView>(`${base}/function`);
      apply(view, resetForm);
      return view;
    },
    [api, base, apply],
  );

  useEffect(() => {
    let cancelled = false;
    api<AgentFunctionConfigView>(`${base}/function`)
      .then((view) => !cancelled && apply(view, true))
      .catch(
        (e: unknown) =>
          !cancelled && setError(errorMessage(e, 'Não foi possível carregar a função do agente.')),
      );
    return () => {
      cancelled = true;
    };
  }, [api, base, apply]);

  // Publicação em andamento: acompanha até terminar e atualiza o agente do cabeçalho. O
  // formulário fica travado: ao terminar ele volta ao que foi salvo, e uma edição se perderia.
  const pending = config?.publication.status === 'PENDING';
  const locked = readOnly || pending;

  /** Publicação que terminou: atualiza o agente do cabeçalho e troca o "Publicando…". */
  const settle = useCallback(
    async (view: AgentFunctionConfigView) => {
      setAgent(await api<AgentView>(base));
      if (view.publication.status === 'IDLE') {
        setNotice('Publicação concluída: o agente já está com a nova configuração.');
        await load(true);
      } else {
        // A falha aparece no próprio aviso, com "Tentar de novo".
        setNotice(null);
      }
    },
    [api, base, load, setAgent],
  );

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(async () => {
      try {
        const view = await load(false);
        if (view.publication.status !== 'PENDING') await settle(view);
      } catch {
        // Tenta de novo no próximo intervalo.
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [pending, load, settle]);

  function publishBody(): FunctionPublishInput {
    return {
      answers,
      mode,
      additionalInstructions: mode === 'ADVANCED' ? additional : null,
      takenOverBehavior: mode === 'TAKEN_OVER' ? takenOver : null,
    };
  }

  async function saveDraft() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api(`${base}/function/draft`, { method: 'PUT', body: JSON.stringify({ answers }) });
      setIssues([]);
      setNotice('Rascunho salvo. O agente só muda quando você publicar.');
    } catch (e) {
      setIssues(issuesOf(e) ?? []);
      setError(errorMessage(e, 'Não foi possível salvar o rascunho.'));
    } finally {
      setBusy(false);
    }
  }

  async function openPreview() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await api<FunctionPreview>(`${base}/function/preview`, {
        method: 'POST',
        body: JSON.stringify(publishBody()),
      });
      setIssues(result.issues);
      if (result.issues.length) {
        setError('Revise os campos destacados antes de publicar.');
      } else {
        setPreview(result);
      }
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível montar a prévia.'));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    try {
      const result = await api<{ status: 'NOTHING' | 'PENDING' }>(`${base}/function/publish`, {
        method: 'POST',
        body: JSON.stringify(publishBody()),
      });
      setPreview(null);
      setNotice(
        result.status === 'NOTHING'
          ? 'Nada mudou: o agente já está assim.'
          : 'Publicando… Os treinamentos e as ações são aplicados em segundo plano.',
      );
      const view = await load(false);
      // O worker pode terminar antes desta leitura: aí o acompanhamento nem começa.
      if (result.status === 'PENDING' && view.publication.status !== 'PENDING') await settle(view);
    } catch (e) {
      setPreview(null);
      setIssues(issuesOf(e) ?? issues);
      setError(errorMessage(e, 'Não foi possível publicar.'));
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      setConfig(await api<AgentFunctionConfigView>(`${base}/function/retry`, { method: 'POST' }));
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível repetir a publicação.'));
    } finally {
      setBusy(false);
    }
  }

  /** Diff do texto com a versão nova, para as respostas publicadas (spec "aviso de versão nova"). */
  async function showUpdate() {
    if (!config) return;
    setError(null);
    setBusy(true);
    try {
      const result = await api<FunctionPreview>(`${base}/function/preview`, {
        method: 'POST',
        body: JSON.stringify({
          answers: config.answers,
          mode: config.mode,
          additionalInstructions: config.additionalInstructions,
        }),
      });
      setUpdate(result);
      // Campo novo da versão: aparece destacado no formulário antes da prévia.
      setIssues(result.issues);
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível comparar com a versão nova.'));
    } finally {
      setBusy(false);
    }
  }

  function applyMode(to: FunctionMode) {
    if (to === 'TAKEN_OVER' && !takenOver) setTakenOver(agent.behavior ?? '');
    if (config?.mode === 'TAKEN_OVER' && to !== 'TAKEN_OVER') setTakenOver('');
    setMode(to);
    setModeRequest(null);
    setNotice('Modo alterado. Publique para aplicar no agente.');
  }

  if (!config) return error ? <Alert tone="error">{error}</Alert> : <Loading />;

  return (
    <div className="max-w-4xl space-y-6">
      <Suspense>
        <CreatedNotice />
      </Suspense>
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {pending && (
        <Alert tone="warning">
          Publicação em andamento. Os treinamentos e as ações estão sendo aplicados no agente.
        </Alert>
      )}
      {config.publication.status === 'FAILED' && (
        <Alert tone="error">
          <p>A última publicação não terminou: {config.publication.error}</p>
          {!readOnly && (
            <button
              type="button"
              className={`${buttonClass('secondary', 'sm')} mt-2`}
              disabled={busy}
              onClick={retry}
            >
              {busy ? 'Repetindo…' : 'Tentar de novo'}
            </button>
          )}
        </Alert>
      )}
      {config.needsRepublishReason && <Alert tone="warning">{config.needsRepublishReason}</Alert>}
      {config.updateAvailable && (
        <Alert tone="warning">
          <p>
            Há uma versão nova da função {config.function.name} (versão {config.latestVersion}; o
            agente está na {config.version}). Confira o que muda e publique quando quiser.
          </p>
          {update ? (
            <div className="mt-3 space-y-2">
              {update.plan.behavior.changed ? (
                <BehaviorDiff lines={update.plan.behavior.diff} />
              ) : (
                <p>O texto do agente não muda; a versão nova altera outras partes da função.</p>
              )}
              {update.issues.length > 0 && (
                <p>A versão nova pede respostas novas: preencha os campos destacados abaixo.</p>
              )}
            </div>
          ) : (
            <button
              type="button"
              className={`${buttonClass('secondary', 'sm')} mt-2`}
              disabled={busy}
              onClick={showUpdate}
            >
              Ver o que muda no texto
            </button>
          )}
        </Alert>
      )}

      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-semibold text-zinc-900">{config.function.name}</p>
          <p className="mt-0.5 text-sm text-zinc-500">{config.function.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={mode === 'SIMPLE' ? 'zinc' : 'amber'}>Modo {MODES[mode]}</Badge>
          {!readOnly && mode === 'SIMPLE' && (
            <button
              type="button"
              className={buttonClass('secondary', 'sm')}
              disabled={pending}
              onClick={() =>
                setModeRequest({
                  title: 'Ligar o modo avançado?',
                  text: 'O modo avançado libera instruções adicionais e treinamento por site e vídeo. Instruções mal escritas podem piorar o atendimento: prefira o formulário sempre que possível.',
                  choices: [{ to: 'ADVANCED', label: 'Continuar' }],
                })
              }
            >
              Modo avançado
            </button>
          )}
          {!readOnly && mode === 'ADVANCED' && (
            <button
              type="button"
              className={buttonClass('secondary', 'sm')}
              disabled={pending}
              onClick={() =>
                setModeRequest({
                  title: 'Voltar ao modo simples?',
                  text: 'Ao publicar, as instruções adicionais e os treinamentos por site e vídeo serão removidos.',
                  choices: [{ to: 'SIMPLE', label: 'Continuar' }],
                })
              }
            >
              Voltar ao modo simples
            </button>
          )}
          {!readOnly && config.canTakeOver && mode !== 'TAKEN_OVER' && (
            <button
              type="button"
              className={buttonClass('ghost', 'sm')}
              disabled={pending}
              onClick={() =>
                setModeRequest({
                  title: 'Assumir o controle do texto?',
                  text: `Você passa a editar o texto do agente livremente. O agente deixa de receber as melhorias da função até voltar ao formulário.${mode === 'ADVANCED' ? ' Os treinamentos por site e vídeo são do modo avançado e saem ao publicar.' : ''}`,
                  choices: [{ to: 'TAKEN_OVER', label: 'Continuar' }],
                })
              }
            >
              Assumir controle
            </button>
          )}
          {!readOnly && mode === 'TAKEN_OVER' && (
            <button
              type="button"
              className={buttonClass('secondary', 'sm')}
              disabled={pending}
              onClick={() =>
                setModeRequest({
                  title: 'Voltar ao formulário?',
                  text: 'As edições feitas no texto do agente serão perdidas. O texto volta a ser montado pelo formulário, na versão mais recente da função. No modo avançado você pode acrescentar instruções e treinar por site e vídeo.',
                  choices: [
                    { to: 'ADVANCED', label: 'Voltar no modo avançado' },
                    { to: 'SIMPLE', label: 'Voltar no modo simples' },
                  ],
                })
              }
            >
              Voltar ao formulário
            </button>
          )}
        </div>
      </Card>

      {mode === 'ADVANCED' && (
        <Card className="p-5">
          <Field
            label="Instruções adicionais"
            hint={`Entram no fim do texto do agente. ${additional.length}/${FUNCTION_ADDITIONAL_INSTRUCTIONS_MAX} caracteres.`}
          >
            <textarea
              className={`${inputClass} min-h-24`}
              maxLength={FUNCTION_ADDITIONAL_INSTRUCTIONS_MAX}
              value={additional}
              disabled={locked}
              onChange={(e) => setAdditional(e.target.value)}
            />
          </Field>
        </Card>
      )}

      {mode === 'TAKEN_OVER' && (
        <Card className="p-5">
          <Field
            label="Texto do agente"
            hint={`Edição livre. ${takenOver.length}/${FUNCTION_BEHAVIOR_MAX} caracteres.`}
          >
            <textarea
              className={`${inputClass} min-h-64 font-mono text-xs`}
              maxLength={FUNCTION_BEHAVIOR_MAX}
              value={takenOver}
              disabled={locked}
              onChange={(e) => setTakenOver(e.target.value)}
            />
          </Field>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0 space-y-4">
          {mode !== 'TAKEN_OVER' && (
            <div className="xl:hidden">
              <BehaviorMeter
                form={config.form}
                answers={answers}
                agentName={agent.name}
                mode={mode}
                additionalInstructions={additional}
              />
            </div>
          )}
          <FunctionForm
            form={config.form}
            answers={answers}
            onChange={setAnswers}
            issues={issues}
            disabled={locked || busy}
            agents={transferAgents}
          />
        </div>
        <aside className="hidden space-y-4 xl:sticky xl:top-6 xl:block xl:self-start">
          {mode !== 'TAKEN_OVER' && (
            <BehaviorMeter
              form={config.form}
              answers={answers}
              agentName={agent.name}
              mode={mode}
              additionalInstructions={additional}
            />
          )}
          <div className="rounded-2xl border border-zinc-200/80 bg-white p-3 shadow-xs">
            <FunctionFormOutline form={config.form} answers={answers} issues={issues} />
          </div>
        </aside>
      </div>

      {!readOnly && (
        <div className="sticky bottom-4 z-10 flex items-center justify-end gap-2 rounded-xl border border-zinc-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
          <button
            type="button"
            className={buttonClass('ghost')}
            disabled={busy || pending}
            onClick={saveDraft}
          >
            Salvar rascunho
          </button>
          <button
            type="button"
            className={buttonClass('primary')}
            disabled={busy || pending}
            onClick={openPreview}
          >
            Ver prévia e publicar
          </button>
        </div>
      )}

      {modeRequest && (
        <Modal
          title={modeRequest.title}
          onRequestClose={() => setModeRequest(null)}
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={buttonClass('secondary')}
                onClick={() => setModeRequest(null)}
              >
                Cancelar
              </button>
              {modeRequest.choices.map((choice, index) => (
                <button
                  key={choice.to}
                  type="button"
                  className={buttonClass(
                    index === modeRequest.choices.length - 1 ? 'primary' : 'secondary',
                  )}
                  onClick={() => applyMode(choice.to)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          }
        >
          <p className="text-sm text-zinc-700">{modeRequest.text}</p>
        </Modal>
      )}

      {preview && (
        <Modal
          title="Prévia da publicação"
          description={
            preview.version.from !== null && preview.version.from !== preview.version.to
              ? `A função passa da versão ${preview.version.from} para a ${preview.version.to}.`
              : 'Confira o que muda no agente.'
          }
          onRequestClose={() => !busy && setPreview(null)}
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={buttonClass('secondary')}
                disabled={busy}
                onClick={() => setPreview(null)}
              >
                Voltar
              </button>
              <button
                type="button"
                className={buttonClass('primary')}
                disabled={busy || preview.compiled.errors.length > 0}
                onClick={publish}
              >
                {busy ? 'Publicando…' : 'Publicar'}
              </button>
            </div>
          }
        >
          <FunctionPreviewView
            preview={preview}
            modeChange={mode !== config.mode ? MODES[mode].toLowerCase() : null}
          />
        </Modal>
      )}
    </div>
  );
}
