'use client';

import type {
  AgentFunctionConfigView,
  AgentView,
  AnswerIssue,
  FunctionAnswers,
  FunctionMode,
  FunctionPreview,
  FunctionPublishInput,
  ReviewGap,
} from '@gptmaker/contracts';
import {
  flattenFields,
  FUNCTION_ADDITIONAL_INSTRUCTIONS_MAX,
  FUNCTION_BEHAVIOR_MAX,
} from '@gptmaker/contracts';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Card, Loading } from '@/components/ui';
import { useErrorMessage, useT } from '@/i18n';
import { errorMessage } from '@/lib/agents';
import { ApiRequestError } from '@/lib/platform-session';
import { useAppSession } from '../../../session-provider';
import { useTransferAgents } from '../../use-transfer-agents';
import { Field, inputClass } from '../../agent-fields';
import { BehaviorMeter, FunctionForm, FunctionFormOutline } from '../../function-form';
import { BehaviorDiff, FunctionPreviewView } from '../../function-preview';
import { attentionCount, withGapItem } from '../../review-logic';
import { ReviewPanel } from '../../review-ui';
import { useAiKey, useFunctionReview } from '../../use-function-review';
import { useAgent } from '../agent-context';

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
  const t = useT('agentFunction');
  const created = useSearchParams().get('created');
  if (!created) return null;
  return <Alert tone="success">{t('createdNotice')}</Alert>;
}

/** Aba Função: formulário, modos e publicação (spec agent-function-configuration). */
export default function AgentFunctionPage() {
  const { session, api } = useAppSession();
  const { agent, setAgent } = useAgent();
  const t = useT('agentFunction');
  const tc = useT('common');
  const translateError = useErrorMessage('agentFunction');
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
  /** Pontos de atenção que pedem confirmação antes da prévia (spec "Avisos não bloqueiam"). */
  const [attention, setAttention] = useState<number | null>(null);
  const [expectation, setExpectation] = useState('');
  const aiKey = useAiKey(api);
  const review = useFunctionReview(api, `/app/agents/${encodeURIComponent(agent.id)}`);
  const ai = useMemo(
    () => ({
      fields: review.state.fields,
      busy: review.running,
      onRerun: (fieldId: string) => void review.run([fieldId], answers),
      onApplied: review.applied,
    }),
    [review, answers],
  );

  const base = `/app/agents/${encodeURIComponent(agent.id)}`;
  const readOnly = !session.canManage || agent.status === 'OUT_OF_SYNC';
  const assist = useMemo(
    () => ({ api, endpoint: `${base}/function/assist`, aiKey }),
    [api, base, aiKey],
  );

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
        (e: unknown) => !cancelled && setError(errorMessage(e, t('loadError'), translateError)),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- o idioma não refaz a leitura
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
        setNotice(t('publishDone'));
        await load(true);
      } else {
        // A falha aparece no próprio aviso, com "Tentar de novo".
        setNotice(null);
      }
    },
    [api, base, load, setAgent, t],
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

  /** "Adicionar" da lacuna: o item entra no fim do campo, pelo mesmo caminho da digitação. */
  function addGap(gap: ReviewGap, index: number) {
    const field = flattenFields(config!.form.fields).find((entry) => entry.id === gap.fieldId);
    if (!field) return;
    const next = withGapItem(field, answers[field.id], gap.item, crypto.randomUUID());
    if (next === null) return;
    setAnswers({ ...answers, [field.id]: next });
    review.gapAdded(index);
  }

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
      setNotice(t('draftSaved'));
    } catch (e) {
      setIssues(issuesOf(e) ?? []);
      setError(errorMessage(e, t('draftError'), translateError));
    } finally {
      setBusy(false);
    }
  }

  async function openPreview(confirmed = false) {
    if (!confirmed && config) {
      const count = attentionCount(config.form, answers);
      if (count > 0) {
        setAttention(count);
        return;
      }
    }
    setAttention(null);
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
        setError(t('reviewFields'));
      } else {
        setPreview(result);
      }
    } catch (e) {
      setError(errorMessage(e, t('previewError'), translateError));
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
      setNotice(result.status === 'NOTHING' ? t('nothingChanged') : t('publishing'));
      const view = await load(false);
      // O worker pode terminar antes desta leitura: aí o acompanhamento nem começa.
      if (result.status === 'PENDING' && view.publication.status !== 'PENDING') await settle(view);
    } catch (e) {
      setPreview(null);
      setIssues(issuesOf(e) ?? issues);
      setError(errorMessage(e, t('publishError'), translateError));
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
      setError(errorMessage(e, t('retryError'), translateError));
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
      setError(errorMessage(e, t('compareError'), translateError));
    } finally {
      setBusy(false);
    }
  }

  function applyMode(to: FunctionMode) {
    if (to === 'TAKEN_OVER' && !takenOver) setTakenOver(agent.behavior ?? '');
    if (config?.mode === 'TAKEN_OVER' && to !== 'TAKEN_OVER') setTakenOver('');
    setMode(to);
    setModeRequest(null);
    setNotice(t('modeChanged'));
  }

  if (!config) return error ? <Alert tone="error">{error}</Alert> : <Loading />;

  return (
    <div className="space-y-6">
      <Suspense>
        <CreatedNotice />
      </Suspense>
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {pending && <Alert tone="warning">{t('pending')}</Alert>}
      {config.publication.status === 'FAILED' && (
        <Alert tone="error">
          <p>{t('lastFailed', { error: config.publication.error ?? '' })}</p>
          {!readOnly && (
            <button
              type="button"
              className={`${buttonClass('secondary', 'sm')} mt-2`}
              disabled={busy}
              onClick={retry}
            >
              {busy ? t('retrying') : t('retry')}
            </button>
          )}
        </Alert>
      )}
      {config.needsRepublishReason && <Alert tone="warning">{config.needsRepublishReason}</Alert>}
      {config.updateAvailable && (
        <Alert tone="warning">
          <p>
            {t('updateAvailable', {
              name: config.function.name,
              latest: config.latestVersion,
              current: config.version ?? '',
            })}
          </p>
          {update ? (
            <div className="mt-3 space-y-2">
              {update.plan.behavior.changed ? (
                <BehaviorDiff lines={update.plan.behavior.diff} />
              ) : (
                <p>{t('updateNoTextChange')}</p>
              )}
              {update.issues.length > 0 && <p>{t('updateNeedsAnswers')}</p>}
            </div>
          ) : (
            <button
              type="button"
              className={`${buttonClass('secondary', 'sm')} mt-2`}
              disabled={busy}
              onClick={showUpdate}
            >
              {t('showUpdate')}
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
          <Badge tone={mode === 'SIMPLE' ? 'zinc' : 'amber'}>
            {t('modeBadge', { mode: t(`modes.${mode}`) })}
          </Badge>
          {!readOnly && mode === 'SIMPLE' && (
            <button
              type="button"
              className={buttonClass('secondary', 'sm')}
              disabled={pending}
              onClick={() =>
                setModeRequest({
                  title: t('requests.toAdvanced.title'),
                  text: t('requests.toAdvanced.text'),
                  choices: [{ to: 'ADVANCED', label: t('continue') }],
                })
              }
            >
              {t('advancedMode')}
            </button>
          )}
          {!readOnly && mode === 'ADVANCED' && (
            <button
              type="button"
              className={buttonClass('secondary', 'sm')}
              disabled={pending}
              onClick={() =>
                setModeRequest({
                  title: t('requests.toSimple.title'),
                  text: t('requests.toSimple.text'),
                  choices: [{ to: 'SIMPLE', label: t('continue') }],
                })
              }
            >
              {t('backToSimple')}
            </button>
          )}
          {!readOnly && config.canTakeOver && mode !== 'TAKEN_OVER' && (
            <button
              type="button"
              className={buttonClass('ghost', 'sm')}
              disabled={pending}
              onClick={() =>
                setModeRequest({
                  title: t('requests.toTakeOver.title'),
                  text: t(
                    mode === 'ADVANCED'
                      ? 'requests.toTakeOver.textAdvanced'
                      : 'requests.toTakeOver.text',
                  ),
                  choices: [{ to: 'TAKEN_OVER', label: t('continue') }],
                })
              }
            >
              {t('takeOver')}
            </button>
          )}
          {!readOnly && mode === 'TAKEN_OVER' && (
            <button
              type="button"
              className={buttonClass('secondary', 'sm')}
              disabled={pending}
              onClick={() =>
                setModeRequest({
                  title: t('requests.toForm.title'),
                  text: t('requests.toForm.text'),
                  choices: [
                    { to: 'ADVANCED', label: t('requests.toForm.advanced') },
                    { to: 'SIMPLE', label: t('requests.toForm.simple') },
                  ],
                })
              }
            >
              {t('backToForm')}
            </button>
          )}
        </div>
      </Card>

      {mode === 'ADVANCED' && (
        <Card className="p-5">
          <Field
            label={t('additional.label')}
            hint={t('additional.hint', {
              count: additional.length,
              max: FUNCTION_ADDITIONAL_INSTRUCTIONS_MAX,
            })}
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
            label={t('takenOverText.label')}
            hint={t('takenOverText.hint', {
              count: takenOver.length,
              max: FUNCTION_BEHAVIOR_MAX,
            })}
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

      {!readOnly && (
        <ReviewPanel
          form={config.form}
          answers={answers}
          aiKey={aiKey}
          state={review.state}
          running={review.running}
          disabled={locked || busy}
          canConfigureKey={session.user.isAdmin}
          expectation={expectation}
          onExpectation={setExpectation}
          onAddGap={addGap}
          onReview={(ids) => void review.run(ids, answers, expectation)}
          onRetryFailed={(ids) => void review.run(ids, answers)}
        />
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_16rem]">
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
            ai={ai}
            assist={assist}
            agentId={agent.id}
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
            {t('saveDraft')}
          </button>
          <button
            type="button"
            className={buttonClass('primary')}
            disabled={busy || pending}
            onClick={() => void openPreview()}
          >
            {t('previewAndPublish')}
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
                {tc('cancel')}
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

      {attention !== null && (
        <Modal
          title={t('attention.title', { count: attention })}
          description={t('attention.description')}
          onRequestClose={() => setAttention(null)}
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={buttonClass('secondary')}
                onClick={() => setAttention(null)}
              >
                {t('attention.review')}
              </button>
              <button
                type="button"
                className={buttonClass('primary')}
                onClick={() => void openPreview(true)}
              >
                {t('attention.publishAnyway')}
              </button>
            </div>
          }
        >
          <p className="text-sm text-zinc-700">{t('attention.body')}</p>
        </Modal>
      )}

      {preview && (
        <Modal
          title={t('preview.title')}
          description={
            preview.version.from !== null && preview.version.from !== preview.version.to
              ? t('preview.versionChange', { from: preview.version.from, to: preview.version.to })
              : t('preview.default')
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
                {t('preview.back')}
              </button>
              <button
                type="button"
                className={buttonClass('primary')}
                disabled={busy || preview.compiled.errors.length > 0}
                onClick={publish}
              >
                {busy ? t('preview.publishing') : t('preview.publish')}
              </button>
            </div>
          }
        >
          <FunctionPreviewView
            preview={preview}
            modeChange={mode !== config.mode ? t(`modes.${mode}`).toLowerCase() : null}
          />
        </Modal>
      )}
    </div>
  );
}
