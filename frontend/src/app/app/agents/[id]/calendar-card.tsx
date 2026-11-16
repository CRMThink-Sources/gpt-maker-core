'use client';

import {
  CALENDAR_MAX_DAYS_AHEAD,
  CALENDAR_MIN_NOTICE_MINUTES,
  CALENDAR_MODES,
  CALENDAR_SLOT_MINUTES,
  CALENDAR_USERS_MAX,
  type CalendarConfigView,
  calendarConfigInputSchema,
} from '@gptmaker/contracts';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Card, Spinner } from '@/components/ui';
import { useErrorMessage, useT } from '@/i18n';
import { errorMessage } from '@/lib/agents';
import {
  type CalendarDraft,
  calendarValidationMessage,
  describeCalendar,
  draftOf,
  getCalendarConfig,
  inputOf,
  removeCalendarConfig,
  saveCalendarConfig,
  toNameMap,
} from '@/lib/calendar';
import { CRM_ACCESS_CHANGED_EVENT } from '@/lib/crm';
import { userNames } from '@/lib/portal-users';
import { useAppSession } from '../../session-provider';
import { Field, inputClass } from '../agent-fields';
import { ResponsiblePicker, UsersPicker } from '../bitrix-pickers';
import { useAgent } from './agent-context';

/** Bloco "Agenda" do agente (spec agent-calendar-scheduling); some com o recurso desligado. */
export function CalendarCard() {
  const { session, api } = useAppSession();
  const { agent } = useAgent();
  const t = useT('calendar');
  const tc = useT('common');
  const translateError = useErrorMessage('calendar');
  const [view, setView] = useState<CalendarConfigView | null>(null);
  const [names, setNames] = useState<Record<number, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<CalendarDraft | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Sobe a cada escrita (ao começar e ao terminar): uma leitura que estava em andamento é do
  // estado antigo e não pode sobrescrever o resultado de salvar ou remover.
  const writes = useRef(0);

  const featureOn = session.features?.crmTools === true;
  const canManage = session.canManage && agent.status !== 'OUT_OF_SYNC';

  useEffect(() => {
    if (!featureOn) return;
    let cancelled = false;
    const startedAt = writes.current;
    const stale = () => cancelled || writes.current !== startedAt;
    getCalendarConfig(api, agent.id)
      .then((next) => {
        if (stale()) return;
        setView(next);
        setLoadError(null);
        const ids = next.config?.userIds ?? [];
        if (ids.length > 0) {
          void userNames(ids.map(String)).then((found) => !stale() && setNames(toNameMap(found)));
        }
      })
      .catch(
        (e: unknown) => !stale() && setLoadError(errorMessage(e, t('loadError'), translateError)),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- o idioma não refaz a leitura
  }, [api, agent.id, featureOn, reload]);

  // O acesso ao CRM foi ligado ou desligado no bloco ao lado: a agenda depende dele.
  useEffect(() => {
    const onChange = () => setReload((count) => count + 1);
    window.addEventListener(CRM_ACCESS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CRM_ACCESS_CHANGED_EVENT, onChange);
  }, []);

  function edit() {
    setError(null);
    setDraft(draftOf(view?.config ?? null));
    setFormKey((key) => key + 1);
  }

  async function save() {
    if (!draft) return;
    setError(null);
    const input = inputOf(draft);
    if (!input) {
      setError(t('fillNumbers'));
      return;
    }
    const parsed = calendarConfigInputSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue ? calendarValidationMessage(issue, input, t) : t('checkFields'));
      return;
    }
    setBusy('save');
    writes.current += 1;
    try {
      const saved = await saveCalendarConfig(api, agent.id, parsed.data);
      setView(saved);
      setLoadError(null);
      setDraft(null);
      void userNames(parsed.data.userIds.map(String)).then((found) => setNames(toNameMap(found)));
    } catch (e) {
      setError(errorMessage(e, t('saveError'), translateError));
    } finally {
      writes.current += 1;
      setBusy(null);
    }
  }

  async function remove() {
    setConfirming(false);
    setBusy('remove');
    setError(null);
    writes.current += 1;
    try {
      setView(await removeCalendarConfig(api, agent.id));
      setLoadError(null);
      setDraft(null);
    } catch (e) {
      setError(errorMessage(e, t('removeError'), translateError));
    } finally {
      writes.current += 1;
      setBusy(null);
    }
  }

  if (!featureOn) return null;
  if (!view) {
    // Primeira leitura: com erro, o aviso e como tentar de novo; sem ele, o carregamento.
    return loadError ? (
      <Alert tone="error" className="mt-6">
        <p>{loadError}</p>
        <button
          type="button"
          onClick={() => {
            setLoadError(null);
            setReload((count) => count + 1);
          }}
          className={`${buttonClass('secondary', 'sm')} mt-2`}
        >
          {t('retry')}
        </button>
      </Alert>
    ) : (
      <p className="mt-6 flex items-center gap-2 text-sm text-zinc-500" role="status">
        <Spinner className="size-4" />
        {t('loading')}
      </p>
    );
  }

  const config = view.config;
  const summary = config ? describeCalendar(config, names, t) : null;

  return (
    <Card className="mt-6 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-zinc-900">{t('title')}</h2>
            <Badge tone={config ? 'green' : 'zinc'}>
              {config ? t('configured') : t('notConfigured')}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-zinc-500">{t('intro')}</p>
        </div>
        {canManage && !draft && view.crmConnected && (
          <button type="button" onClick={edit} className={buttonClass('secondary')}>
            {config ? t('edit') : t('configure')}
          </button>
        )}
      </div>

      <div className="space-y-3 border-t border-zinc-100 px-5 py-3.5 text-sm">
        {view.scopeMissing && <Alert tone="warning">{t('scopeMissing')}</Alert>}
        {!view.crmConnected && <Alert tone="warning">{t('crmRequired')}</Alert>}
        {loadError && (
          <Alert tone="error">
            <p>{t('staleLoadError', { error: loadError })}</p>
            <button
              type="button"
              onClick={() => {
                setLoadError(null);
                setReload((count) => count + 1);
              }}
              className={`${buttonClass('secondary', 'sm')} mt-2`}
            >
              {t('retry')}
            </button>
          </Alert>
        )}
        {error && !draft && <Alert tone="error">{error}</Alert>}
        {session.canManage && agent.status === 'OUT_OF_SYNC' && (
          <Alert tone="warning">{t('outOfSync')}</Alert>
        )}
        {busy === 'remove' && (
          <p className="flex items-center gap-2 text-zinc-600" role="status">
            <Spinner className="size-4" />
            {t('removing')}
          </p>
        )}

        {summary && !draft && (
          <dl className="space-y-1 text-zinc-700">
            <div>
              <dt className="inline font-medium">{t('ownerLabel')} </dt>
              <dd className="inline">
                {t(`modes.${config!.mode}`)} — {summary.owner}
              </dd>
            </div>
            <p className="text-xs text-zinc-500">{summary.rules}</p>
          </dl>
        )}
        {!config && !draft && <p className="text-zinc-500">{t('empty')}</p>}

        {draft && (
          <form
            key={formKey}
            // Quem valida é o contrato (mensagens traduzidas por `calendarValidationMessage`); sem isto
            // o navegador bloqueia o envio e mostra a própria mensagem de `min`/`max`/`step`.
            noValidate
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-zinc-800">{t('modeLegend')}</legend>
              {CALENDAR_MODES.map((mode) => (
                <label key={mode} className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="calendar-mode"
                    className="mt-1"
                    checked={draft.mode === mode}
                    disabled={busy !== null}
                    onChange={() =>
                      setDraft({
                        ...draft,
                        mode,
                        // Um usuário só no modo fixo; nenhum no do responsável do cliente.
                        userIds:
                          mode === 'FIXED_USER'
                            ? draft.userIds.slice(0, 1)
                            : mode === 'CLIENT_OWNER'
                              ? []
                              : draft.userIds,
                      })
                    }
                  />
                  <span>
                    <span className="font-medium text-zinc-800">{t(`modes.${mode}`)}</span>
                    <span className="block text-xs text-zinc-500">{t(`modeHints.${mode}`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {draft.mode === 'FIXED_USER' && (
              <ResponsiblePicker
                key={`fixed-${formKey}`}
                label={t('attendant')}
                value={draft.userIds[0] ?? 0}
                knownName={names[draft.userIds[0] ?? 0]}
                disabled={busy !== null}
                onChange={(id) => setDraft({ ...draft, userIds: id > 0 ? [id] : [] })}
              />
            )}
            {draft.mode === 'USER_LIST' && (
              <UsersPicker
                key={`list-${formKey}`}
                label={t('attendant')}
                hint={t('attendantListHint', { max: CALENDAR_USERS_MAX })}
                max={CALENDAR_USERS_MAX}
                value={draft.userIds}
                knownNames={names}
                disabled={busy !== null}
                onChange={(ids) => setDraft({ ...draft, userIds: ids })}
              />
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('slotLabel')} hint={t('slotHint', CALENDAR_SLOT_MINUTES)}>
                <input
                  type="number"
                  className={inputClass}
                  min={CALENDAR_SLOT_MINUTES.min}
                  max={CALENDAR_SLOT_MINUTES.max}
                  step={CALENDAR_SLOT_MINUTES.step}
                  value={draft.slotMinutes}
                  disabled={busy !== null}
                  onChange={(e) => setDraft({ ...draft, slotMinutes: e.target.value })}
                />
              </Field>
              <Field label={t('noticeLabel')} hint={t('noticeHint', CALENDAR_MIN_NOTICE_MINUTES)}>
                <input
                  type="number"
                  className={inputClass}
                  min={CALENDAR_MIN_NOTICE_MINUTES.min}
                  max={CALENDAR_MIN_NOTICE_MINUTES.max}
                  value={draft.minNoticeMinutes}
                  disabled={busy !== null}
                  onChange={(e) => setDraft({ ...draft, minNoticeMinutes: e.target.value })}
                />
              </Field>
              <Field label={t('daysLabel')} hint={t('daysHint', CALENDAR_MAX_DAYS_AHEAD)}>
                <input
                  type="number"
                  className={inputClass}
                  min={CALENDAR_MAX_DAYS_AHEAD.min}
                  max={CALENDAR_MAX_DAYS_AHEAD.max}
                  value={draft.maxDaysAhead}
                  disabled={busy !== null}
                  onChange={(e) => setDraft({ ...draft, maxDaysAhead: e.target.value })}
                />
              </Field>
            </div>

            {error && <Alert tone="error">{error}</Alert>}

            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" disabled={busy !== null} className={buttonClass('primary')}>
                {busy === 'save' ? t('saving') : t('save')}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  setDraft(null);
                  setError(null);
                }}
                className={buttonClass('secondary')}
              >
                {tc('cancel')}
              </button>
              {config && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => setConfirming(true)}
                  className={`${buttonClass('danger')} ml-auto`}
                >
                  {t('remove')}
                </button>
              )}
            </div>
          </form>
        )}
      </div>

      {confirming && (
        <Modal
          title={t('confirmTitle')}
          description={agent.name}
          onRequestClose={() => setConfirming(false)}
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className={buttonClass('secondary')}
              >
                {tc('cancel')}
              </button>
              <button type="button" onClick={() => void remove()} className={buttonClass('danger')}>
                {t('confirmRemove')}
              </button>
            </div>
          }
        >
          <p className="text-sm text-zinc-600">{t('confirmBody')}</p>
        </Modal>
      )}
    </Card>
  );
}
