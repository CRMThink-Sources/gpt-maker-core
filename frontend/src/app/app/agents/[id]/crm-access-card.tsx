'use client';

import type { CrmAccessView } from '@gptmaker/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Card, Spinner, Switch, type Tone } from '@/components/ui';
import { useErrorMessage, useFormat, useT } from '@/i18n';
import { errorMessage } from '@/lib/agents';
import { CRM_ACCESS_CHANGED_EVENT, getCrmAccess, setCrmAccess } from '@/lib/crm';
import { useAppSession } from '../../session-provider';
import { useAgent } from './agent-context';

/** Enquanto outra alteração conecta o agente, confere o estado de tempos em tempos. */
const POLL_MS = 5_000;

const STATUS_TONE: Record<CrmAccessView['status'], Tone> = {
  DISABLED: 'zinc',
  CONNECTING: 'brand',
  CONNECTED: 'green',
  ERROR: 'amber',
};

/** Bloco "Acesso ao CRM" do agente (spec agent-crm-tools); some com o recurso desligado. */
export function CrmAccessCard() {
  const { session, api } = useAppSession();
  const { agent } = useAgent();
  const t = useT('agentDetail');
  const tc = useT('common');
  const format = useFormat();
  const translateError = useErrorMessage('agentDetail');
  const [access, setAccess] = useState<CrmAccessView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'on' | 'off' | null>(null);
  const [confirming, setConfirming] = useState(false);

  const featureOn = session.features?.crmTools === true;
  const canManage = session.canManage && agent.status !== 'OUT_OF_SYNC';
  const status = access?.status;

  useEffect(() => {
    if (!featureOn) return;
    let cancelled = false;
    getCrmAccess(api, agent.id)
      .then((view) => !cancelled && setAccess(view))
      .catch(
        (e: unknown) =>
          !cancelled && setLoadError(errorMessage(e, t('crm.loadError'), translateError)),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- o idioma não refaz a leitura
  }, [api, agent.id, featureOn]);

  // Conexão em curso iniciada por outra pessoa/aba: acompanha até terminar.
  useEffect(() => {
    if (status !== 'CONNECTING' || busy) return;
    const timer = setTimeout(() => {
      getCrmAccess(api, agent.id)
        .then(setAccess)
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [api, agent.id, status, busy, access]);

  async function change(enabled: boolean) {
    setBusy(enabled ? 'on' : 'off');
    setError(null);
    setConfirming(false);
    try {
      setAccess(await setCrmAccess(api, agent.id, { enabled }));
      // A agenda (bloco abaixo) só existe com o CRM conectado: avisa para reler o estado.
      window.dispatchEvent(new Event(CRM_ACCESS_CHANGED_EVENT));
    } catch (e) {
      setError(
        errorMessage(e, enabled ? t('crm.turnOnError') : t('crm.turnOffError'), translateError),
      );
      // O servidor pode ter mudado o estado mesmo com erro: relê.
      getCrmAccess(api, agent.id)
        .then(setAccess)
        .catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  if (!featureOn) return null;
  if (loadError) {
    return (
      <Alert tone="error" className="mt-6">
        {loadError}
      </Alert>
    );
  }
  if (!access || !access.available) return null;

  const enabled = access.status !== 'DISABLED';
  // O link fica no meio da frase: a tradução marca o lugar com {link}.
  const [introBefore, introAfter = ''] = t('crm.intro', { link: '\u0001' }).split('\u0001');
  const badgeTone = STATUS_TONE[access.status];

  return (
    <Card className="mt-6 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-zinc-900">{t('crm.title')}</h2>
            <Badge tone={badgeTone}>{t(`crm.status.${access.status}`)}</Badge>
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {introBefore}
            <Link href="/app/crm" className="font-medium text-brand-700 hover:underline">
              {t('crm.linkLabel')}
            </Link>
            {introAfter}
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={!canManage || busy !== null}
          label={t('crm.title')}
          onChange={(value) => (value ? change(true) : setConfirming(true))}
        />
      </div>

      <div className="space-y-3 border-t border-zinc-100 px-5 py-3.5 text-sm">
        {busy && (
          <p className="flex items-center gap-2 text-zinc-600" role="status">
            <Spinner className="size-4" />
            {busy === 'off' ? t('crm.turningOff') : t('crm.connectingSlow')}
          </p>
        )}
        {busy === null && access.status === 'CONNECTING' && (
          <p className="flex items-center gap-2 text-zinc-600" role="status">
            <Spinner className="size-4" />
            {t('crm.connecting')}
          </p>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        {access.status === 'ERROR' && (
          <Alert tone="warning">
            <p>
              {access.lastError
                ? t('crm.connectErrorWithReason', { reason: access.lastError })
                : t('crm.connectError')}
            </p>
            {canManage && (
              <button
                type="button"
                onClick={() => change(true)}
                disabled={busy !== null}
                className={`${buttonClass('secondary', 'sm')} mt-2`}
              >
                {t('crm.retry')}
              </button>
            )}
          </Alert>
        )}
        <p className="text-xs text-zinc-500">
          {access.lastCallAt
            ? t('crm.lastCall', {
                date: format.dateTime(new Date(access.lastCallAt), {
                  dateStyle: 'short',
                  timeStyle: 'short',
                }),
              })
            : t('crm.neverCalled')}
        </p>
      </div>

      {confirming && (
        <Modal
          title={t('crm.confirmTitle')}
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
              <button type="button" onClick={() => change(false)} className={buttonClass('danger')}>
                {t('crm.turnOff')}
              </button>
            </div>
          }
        >
          <p className="text-sm text-zinc-600">{t('crm.confirmBody')}</p>
        </Modal>
      )}
    </Card>
  );
}
