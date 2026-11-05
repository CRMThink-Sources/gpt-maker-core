'use client';

import type { CrmAccessView } from '@gptmaker/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Card, Spinner, Switch } from '@/components/ui';
import { CRM_ACCESS_STATUS, crmErrorMessage, getCrmAccess, setCrmAccess } from '@/lib/crm';
import { formatDateTime } from '@/lib/triggers';
import { useAppSession } from '../../session-provider';
import { useAgent } from './agent-context';

/** Enquanto outra alteração conecta o agente, confere o estado de tempos em tempos. */
const POLL_MS = 5_000;

/** Bloco "Acesso ao CRM" do agente (spec agent-crm-tools); some com o recurso desligado. */
export function CrmAccessCard() {
  const { session, api } = useAppSession();
  const { agent } = useAgent();
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
          !cancelled &&
          setLoadError(crmErrorMessage(e, 'Não foi possível carregar o acesso ao CRM.')),
      );
    return () => {
      cancelled = true;
    };
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
    } catch (e) {
      setError(
        crmErrorMessage(
          e,
          enabled
            ? 'Não foi possível ligar o acesso ao CRM. Tente de novo.'
            : 'Não foi possível desligar o acesso ao CRM. Tente de novo.',
        ),
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
  const badge = CRM_ACCESS_STATUS[access.status];

  return (
    <Card className="mt-6 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-zinc-900">Acesso ao CRM</h2>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            Com o acesso ligado, o agente consulta no Bitrix24 o cliente da conversa e os negócios
            dele para responder com mais contexto. Ele só lê os campos liberados em{' '}
            <Link href="/app/crm" className="font-medium text-brand-700 hover:underline">
              CRM para o agente
            </Link>
            .
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={!canManage || busy !== null}
          label="Acesso ao CRM"
          onChange={(value) => (value ? change(true) : setConfirming(true))}
        />
      </div>

      <div className="space-y-3 border-t border-zinc-100 px-5 py-3.5 text-sm">
        {busy && (
          <p className="flex items-center gap-2 text-zinc-600" role="status">
            <Spinner className="size-4" />
            {busy === 'off'
              ? 'Desligando o acesso ao CRM…'
              : 'Conectando o agente ao CRM. Isso pode levar até 30 segundos.'}
          </p>
        )}
        {busy === null && access.status === 'CONNECTING' && (
          <p className="flex items-center gap-2 text-zinc-600" role="status">
            <Spinner className="size-4" />
            Conectando o agente ao CRM…
          </p>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        {access.status === 'ERROR' && (
          <Alert tone="warning">
            <p>
              Não foi possível conectar o agente ao CRM
              {access.lastError ? `: ${access.lastError}` : '.'}
            </p>
            {canManage && (
              <button
                type="button"
                onClick={() => change(true)}
                disabled={busy !== null}
                className={`${buttonClass('secondary', 'sm')} mt-2`}
              >
                Tentar de novo
              </button>
            )}
          </Alert>
        )}
        <p className="text-xs text-zinc-500">
          {access.lastCallAt
            ? `Última consulta ao CRM: ${formatDateTime(access.lastCallAt)}.`
            : 'O agente ainda não consultou o CRM.'}
        </p>
      </div>

      {confirming && (
        <Modal
          title="Desligar o acesso ao CRM?"
          description={agent.name}
          onRequestClose={() => setConfirming(false)}
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className={buttonClass('secondary')}
              >
                Cancelar
              </button>
              <button type="button" onClick={() => change(false)} className={buttonClass('danger')}>
                Desligar
              </button>
            </div>
          }
        >
          <p className="text-sm text-zinc-600">
            O agente deixa de consultar o cliente da conversa e os negócios dele no Bitrix24. As
            escolhas de campos em &quot;CRM para o agente&quot; continuam salvas e você pode ligar o
            acesso de novo quando quiser.
          </p>
        </Modal>
      )}
    </Card>
  );
}
