'use client';

import {
  type AiKeyView,
  type ConversationList,
  type ConversationMessages,
  type ConversationSource,
  type ConversationSummary,
  flattenFields,
  type FunctionAnswers,
  type FunctionTemplateContent,
  type HallucinationFinding,
  type HallucinationResult,
} from '@gptmaker/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Card, Loading } from '@/components/ui';
import { useErrorMessage, useFormat, useT } from '@/i18n';
import { errorMessage } from '@/lib/agents';
import { useAppSession } from '../session-provider';
import {
  analysisCost,
  analysisPath,
  applySuggestion,
  buildRequest,
  causeKey,
  conversationMessagesPath,
  conversationsPath,
  flaggable,
  readOnlyReasonKey,
  suggestionApplicable,
  toggleFlag,
  VERDICT_TONE,
  verdictKey,
} from './hallucination-logic';

type Step = 'list' | 'conversation' | 'result';

/** Mensagens da conversa escolhida: carregando, prontas ou a falha já traduzida. */
type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; data: ConversationMessages }
  | { status: 'error'; message: string };

/**
 * Análise de alucinação (spec agent-hallucination-analysis): escolhe a conversa, marca a resposta
 * suspeita, confirma o envio à IA e mostra o diagnóstico com sugestões que só alteram o formulário.
 */
export function HallucinationModal({
  agentId,
  form,
  answers,
  aiKey,
  canConfigureKey,
  onApply,
  onClose,
}: {
  agentId: string;
  form: FunctionTemplateContent;
  answers: FunctionAnswers;
  aiKey: AiKeyView | null;
  canConfigureKey: boolean;
  /** Recebe as respostas já com a sugestão aplicada; quem chama só atualiza o formulário. */
  onApply: (next: FunctionAnswers) => void;
  onClose: () => void;
}) {
  const { api } = useAppSession();
  const t = useT('hallucination');
  const format = useFormat();
  const translateError = useErrorMessage('assist');
  const [step, setStep] = useState<Step>('list');
  const [source, setSource] = useState<ConversationSource>('TEST');
  const [list, setList] = useState<{
    items: ConversationSummary[];
    next: number | null;
    loading: boolean;
    error: string | null;
  }>({ items: [], next: null, loading: true, error: null });
  const [chosen, setChosen] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<Loaded>({ status: 'loading' });
  const [flagged, setFlagged] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [analysisId, setAnalysisId] = useState(() => crypto.randomUUID());
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HallucinationResult | null>(null);
  const [applied, setApplied] = useState<number[]>([]);
  const listRun = useRef(0);

  const ownKey = aiKey?.configured ?? false;
  const unavailable = !!aiKey && !aiKey.configured && !aiKey.platformAvailable;
  const cost = analysisCost(aiKey?.creditsPerAnalysis ?? aiKey?.creditsPerField ?? 0, ownKey, t);
  const labels = new Map(flattenFields(form.fields).map((field) => [field.id, field.label]));

  /** Lê uma página das conversas; `cursor` 0 recomeça a lista (troca de origem). */
  const load = useCallback(
    async (origin: ConversationSource, cursor: number) => {
      const run = ++listRun.current;
      setList((prev) => ({
        items: cursor === 0 ? [] : prev.items,
        next: cursor === 0 ? null : prev.next,
        loading: true,
        error: null,
      }));
      try {
        const page = await api<ConversationList>(conversationsPath(agentId, origin, cursor));
        if (run !== listRun.current) return;
        setList((prev) => ({
          items: cursor === 0 ? page.conversations : [...prev.items, ...page.conversations],
          next: page.nextCursor,
          loading: false,
          error: null,
        }));
      } catch (e) {
        if (run !== listRun.current) return;
        setList((prev) => ({
          ...prev,
          loading: false,
          error: errorMessage(e, t('loadFailed'), translateError),
        }));
      }
    },
    [api, agentId, t, translateError],
  );

  useEffect(() => {
    void load(source, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recarrega só ao trocar a origem
  }, [source]);

  async function choose(conversation: ConversationSummary) {
    setChosen(conversation);
    setFlagged([]);
    setNote('');
    setError(null);
    setAnalysisId(crypto.randomUUID());
    setMessages({ status: 'loading' });
    setStep('conversation');
    try {
      const data = await api<ConversationMessages>(
        conversationMessagesPath(agentId, conversation.source, conversation.id),
      );
      setMessages({ status: 'ready', data });
    } catch (e) {
      setMessages({ status: 'error', message: errorMessage(e, t('loadFailed'), translateError) });
    }
  }

  async function analyze() {
    if (!chosen) return;
    setError(null);
    setRunning(true);
    try {
      const response = await api<HallucinationResult>(analysisPath(agentId), {
        method: 'POST',
        body: JSON.stringify(
          buildRequest({
            analysisId,
            source: chosen.source,
            conversationId: chosen.id,
            flagged,
            note,
            answers,
          }),
        ),
      });
      setResult(response);
      setApplied([]);
      setStep('result');
    } catch (e) {
      setError(errorMessage(e, t('failed'), translateError));
    } finally {
      setRunning(false);
    }
  }

  function apply(index: number, finding: HallucinationFinding) {
    if (!finding.suggestion) return;
    // O botão só existe quando a sugestão cabe agora; `null` aqui é o formulário que mudou entre o
    // render e o clique, e a tela passa a mostrar que a sugestão já não cabe.
    const next = applySuggestion(form, answers, finding.suggestion, crypto.randomUUID());
    if (next === null) return;
    onApply(next);
    setApplied((current) => [...current, index]);
  }

  function again() {
    setResult(null);
    setChosen(null);
    setStep('list');
  }

  const ready = messages.status === 'ready' ? messages.data : null;
  const hasAgentReply = !!ready?.messages.some(flaggable);

  return (
    <Modal
      title={t('modal.title')}
      onRequestClose={() => !running && onClose()}
      footer={
        <div className="flex justify-between gap-2">
          <div>
            {step === 'conversation' && (
              <button
                type="button"
                className={buttonClass('secondary')}
                disabled={running}
                onClick={() => setStep('list')}
              >
                {t('modal.back')}
              </button>
            )}
            {step === 'result' && (
              <button type="button" className={buttonClass('secondary')} onClick={again}>
                {t('result.again')}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonClass('secondary')}
              disabled={running}
              onClick={onClose}
            >
              {t('modal.close')}
            </button>
            {step === 'conversation' && (
              <button
                type="button"
                className={buttonClass('primary')}
                disabled={running || unavailable || !hasAgentReply}
                onClick={() => void analyze()}
              >
                {running ? t('analyze.running') : t('analyze.button', { cost: cost.label })}
              </button>
            )}
          </div>
        </div>
      }
    >
      {step === 'list' && (
        <div className="space-y-4">
          <div role="group" aria-label={t('source.label')} className="flex gap-2">
            {(['TEST', 'REAL'] as const).map((origin) => (
              <button
                key={origin}
                type="button"
                aria-pressed={source === origin}
                className={buttonClass(source === origin ? 'primary' : 'secondary', 'sm')}
                onClick={() => setSource(origin)}
              >
                {t(`source.${origin}`)}
              </button>
            ))}
          </div>
          {list.error && <Alert tone="error">{list.error}</Alert>}
          {list.loading && list.items.length === 0 && <Loading />}
          {!list.loading && !list.error && list.items.length === 0 && (
            <p className="text-sm text-zinc-500">{t('list.empty')}</p>
          )}
          <ul className="divide-y divide-zinc-100">
            {list.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-900">{item.title}</p>
                  <p className="text-xs text-zinc-500">
                    {item.at
                      ? format.dateTime(new Date(item.at), { dateStyle: 'short' })
                      : t('list.noDate')}
                    {item.messageCount !== null &&
                      ` · ${t('list.messages', { count: item.messageCount })}`}
                  </p>
                </div>
                <button
                  type="button"
                  className={buttonClass('secondary', 'sm')}
                  onClick={() => void choose(item)}
                >
                  {t('list.choose')}
                </button>
              </li>
            ))}
          </ul>
          {list.next !== null && (
            <button
              type="button"
              className={buttonClass('secondary', 'sm')}
              disabled={list.loading}
              onClick={() => void load(source, list.next!)}
            >
              {t('list.more')}
            </button>
          )}
        </div>
      )}

      {step === 'conversation' && (
        <div className="space-y-4">
          {messages.status === 'loading' && <Loading />}
          {messages.status === 'error' && <Alert tone="error">{messages.message}</Alert>}
          {ready && (
            <>
              <div>
                <p className="text-sm font-medium text-zinc-900">
                  {t('messages.title')}{' '}
                  <span className="font-normal text-zinc-400">{t('messages.optional')}</span>
                </p>
                <p className="text-xs text-zinc-500">{t('messages.hint')}</p>
              </div>
              {ready.omitted > 0 && (
                <Alert tone="warning">{t('messages.truncated', { count: ready.omitted })}</Alert>
              )}
              {!hasAgentReply && <Alert tone="warning">{t('messages.noReply')}</Alert>}
              <ul className="space-y-2">
                {ready.messages.map((message) => {
                  const on = flagged.includes(message.id);
                  return (
                    <li
                      key={message.id}
                      className={`rounded-lg border p-3 text-sm ${
                        on ? 'border-amber-300 bg-amber-50' : 'border-zinc-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-zinc-600">
                          {t(`roles.${message.role}`)}
                        </span>
                        {flaggable(message) && (
                          <button
                            type="button"
                            aria-pressed={on}
                            className={buttonClass(on ? 'primary' : 'secondary', 'sm')}
                            onClick={() => setFlagged((current) => toggleFlag(current, message.id))}
                          >
                            {on ? t('messages.flagged') : t('messages.flag')}
                          </button>
                        )}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-zinc-800">
                        {message.text || (message.hasAttachment ? t('messages.attachment') : '')}
                      </p>
                    </li>
                  );
                })}
              </ul>
              <label className="block text-sm">
                <span className="font-medium text-zinc-800">
                  {t('note.label')}{' '}
                  <span className="font-normal text-zinc-400">{t('messages.optional')}</span>
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">{t('note.help')}</span>
                <textarea
                  className="mt-1 min-h-20 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                  value={note}
                  maxLength={500}
                  disabled={running}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <p className="text-xs text-zinc-600">
                {ownKey ? t('privacy.own') : t('privacy.platform')}
              </p>
              {unavailable && (
                <p className="text-xs text-amber-700">
                  {t('key.required')}{' '}
                  {canConfigureKey ? (
                    <Link href="/app/ai-key" className="font-medium underline">
                      {t('key.configure')}
                    </Link>
                  ) : (
                    t('key.askAdmin')
                  )}
                </p>
              )}
            </>
          )}
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      )}

      {step === 'result' && result && (
        <div className="space-y-4">
          <p className="text-sm font-semibold text-zinc-900">{t('result.title')}</p>
          {result.omitted > 0 && (
            <Alert tone="warning">{t('messages.truncated', { count: result.omitted })}</Alert>
          )}
          {result.findings.length === 0 && (
            <p className="text-sm text-zinc-600">{t('result.none')}</p>
          )}
          {result.findings.map((finding, index) => {
            const suggestion = finding.suggestion;
            const label = suggestion ? (labels.get(suggestion.fieldId) ?? suggestion.fieldId) : '';
            const canApplyNow = !!suggestion && suggestionApplicable(form, answers, suggestion);
            return (
              <Card key={`${finding.messageId}-${index}`} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={VERDICT_TONE[finding.verdict]}>
                    {t(verdictKey(finding.verdict))}
                  </Badge>
                  {finding.cause && (
                    <span className="text-xs text-zinc-600">{t(causeKey(finding.cause))}</span>
                  )}
                </div>
                <p className="text-sm text-zinc-800">
                  <span className="font-medium">{t('result.claim')}:</span> “{finding.claim}”
                </p>
                <p className="text-sm text-zinc-700">{finding.reason}</p>
                {finding.source && (
                  <p className="text-xs text-zinc-500">
                    {finding.source.index === null
                      ? t('result.source', { label: finding.source.label })
                      : t('result.sourceItem', {
                          label: finding.source.label,
                          number: finding.source.index + 1,
                        })}
                  </p>
                )}
                {!suggestion && finding.cause === 'PERMISSIVE_BEHAVIOR' && (
                  <p className="text-xs text-zinc-500">{t('result.behaviorNote')}</p>
                )}
                {suggestion && (
                  <div className="rounded-lg bg-zinc-50 p-3 text-sm">
                    <p className="text-xs font-semibold text-zinc-700">
                      {suggestion.kind === 'ADD_ITEM'
                        ? t('suggestion.add', { field: label })
                        : t('suggestion.replace', { field: label, number: suggestion.index + 1 })}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-zinc-800">
                      {Object.entries(
                        suggestion.kind === 'ADD_ITEM' ? suggestion.item : suggestion.values,
                      ).map(([key, text]) => (
                        <li key={key} className="whitespace-pre-wrap break-words">
                          {text}
                        </li>
                      ))}
                    </ul>
                    {applied.includes(index) ? (
                      <p className="mt-2 text-xs font-medium text-emerald-700">
                        {t('suggestion.applied')}
                      </p>
                    ) : canApplyNow ? (
                      <button
                        type="button"
                        className={`${buttonClass('secondary', 'sm')} mt-2`}
                        onClick={() => apply(index, finding)}
                      >
                        {t('suggestion.apply')}
                      </button>
                    ) : (
                      <p className="mt-2 text-xs text-zinc-500">
                        {suggestion.applicable
                          ? t('suggestion.stale')
                          : t(readOnlyReasonKey(suggestion))}
                      </p>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
          {result.credits > 0 && (
            <p className="text-xs text-zinc-500">
              {t('result.charged', { cost: t('cost.credits', { count: result.credits }) })}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Cartão com o botão "Analisar alucinação", ao lado da revisão por IA na tela da função. */
export function HallucinationEntry({
  agentId,
  form,
  answers,
  aiKey,
  canConfigureKey,
  disabled,
  onApply,
}: {
  agentId: string;
  form: FunctionTemplateContent;
  answers: FunctionAnswers;
  aiKey: AiKeyView | null;
  canConfigureKey: boolean;
  disabled?: boolean;
  onApply: (next: FunctionAnswers) => void;
}) {
  const t = useT('hallucination');
  const [open, setOpen] = useState(false);
  if (!aiKey) return null;
  return (
    <>
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900">{t('panel.title')}</p>
          <p className="mt-0.5 text-xs text-zinc-500">{t('panel.intro')}</p>
        </div>
        <button
          type="button"
          className={buttonClass('secondary')}
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          {t('button')}
        </button>
      </Card>
      {open && (
        <HallucinationModal
          agentId={agentId}
          form={form}
          answers={answers}
          aiKey={aiKey}
          canConfigureKey={canConfigureKey}
          onApply={onApply}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
