'use client';

import type { NotificationRecipientsView, NotificationTestView } from '@gptmaker/contracts';
import { useCallback, useEffect, useState } from 'react';
import { BellIcon, PlusIcon } from '@/components/icons';
import {
  Alert,
  Avatar,
  buttonClass,
  Card,
  EmptyState,
  Loading,
  PageHeader,
  Spinner,
} from '@/components/ui';
import { bx24SelectUsers } from '@/lib/bx24';
import { ApiRequestError } from '@/lib/platform-session';
import { userNames } from '@/lib/portal-users';
import { useAppSession } from '../session-provider';

const NOTICES = [
  '80% dos créditos do ciclo consumidos',
  'Créditos esgotados (as mensagens vão para os atendentes)',
  'Pagamento da assinatura recusado, com o prazo antes de pausar os agentes',
  'Fim do período de assinaturas contratadas com a CRMThink',
];

/**
 * Destinatários dos avisos do app (spec credit-billing, "Destinatários de avisos"; tarefa 11.10):
 * o administrador escolhe quem recebe as notificações no Bitrix24. Sem ninguém, vão para os
 * administradores do portal.
 */
export default function NotificationsPage() {
  const { session, api } = useAppSession();
  const [ids, setIds] = useState<string[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const fetchList = useCallback(async () => {
    const { bitrixUserIds } = await api<NotificationRecipientsView>('/app/notification-recipients');
    return { ids: bitrixUserIds, names: await userNames(bitrixUserIds) };
  }, [api]);

  useEffect(() => {
    if (!session.user.isAdmin) return;
    let cancelled = false;
    fetchList()
      .then((list) => {
        if (cancelled) return;
        setIds(list.ids);
        setNames(list.names);
      })
      .catch(() => !cancelled && setError('Não foi possível carregar os destinatários.'));
    return () => {
      cancelled = true;
    };
  }, [fetchList, session.user.isAdmin]);

  async function save(next: string[]) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { bitrixUserIds } = await api<NotificationRecipientsView>(
        '/app/notification-recipients',
        { method: 'PUT', body: JSON.stringify({ bitrixUserIds: next }) },
      );
      setIds(bitrixUserIds);
      setNames(await userNames(bitrixUserIds));
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const selected = await bx24SelectUsers();
    if (selected.length === 0) return;
    await save([...(ids ?? []), ...selected.map((user) => user.id)]);
  }

  async function test() {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<NotificationTestView>('/app/notification-recipients/test', {
        method: 'POST',
      });
      if (result.status === 'SENT') {
        setNotice(
          `Aviso de teste enviado para ${result.sentTo.length} ${
            result.sentTo.length === 1 ? 'pessoa' : 'pessoas'
          }. Confira as notificações do Bitrix24.`,
        );
      } else if (result.status === 'PENDING') {
        setNotice('O Bitrix24 não respondeu agora; o aviso de teste será reenviado em instantes.');
      } else {
        setError('Não foi possível enviar o aviso de teste: nenhum destinatário ativo.');
      }
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Não foi possível enviar o teste.');
    } finally {
      setTesting(false);
    }
  }

  const header = (
    <PageHeader
      title="Avisos"
      description="Quem recebe no Bitrix24 as notificações de créditos e de pagamento do app."
      actions={
        session.user.isAdmin && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void test()}
              disabled={testing || busy}
              className={buttonClass('secondary')}
            >
              {testing && <Spinner className="size-4" />}
              Enviar aviso de teste
            </button>
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy}
              className={buttonClass('primary')}
            >
              <PlusIcon className="size-4" />
              Adicionar pessoas
            </button>
          </div>
        )
      }
    />
  );

  if (!session.user.isAdmin) {
    return (
      <>
        {header}
        <Alert tone="warning">
          Somente administradores do portal escolhem quem recebe os avisos.
        </Alert>
      </>
    );
  }

  return (
    <>
      {header}
      {error && (
        <Alert tone="error" className="mb-6">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" className="mb-6">
          {notice}
        </Alert>
      )}

      {ids === null ? (
        !error && <Loading />
      ) : (
        <Card>
          {ids.length === 0 ? (
            <EmptyState
              icon={<BellIcon className="size-6" />}
              title="Os avisos vão para os administradores do portal"
              description="Adicione pessoas para que elas recebam os avisos no lugar dos administradores."
            />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {ids.map((id) => {
                const name = names[id] ?? `Usuário #${id}`;
                return (
                  <li key={id} className="flex items-center gap-4 px-5 py-4 text-sm">
                    <Avatar name={name} />
                    <p className="min-w-0 flex-1 truncate font-medium text-zinc-900">{name}</p>
                    <button
                      type="button"
                      onClick={() => void save(ids.filter((other) => other !== id))}
                      disabled={busy}
                      className={buttonClass('ghost-danger', 'sm')}
                    >
                      Remover
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      <Card className="mt-6 p-5">
        <h2 className="text-sm font-semibold text-zinc-900">Quando os avisos são enviados</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600">
          {NOTICES.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-zinc-500">
          Cada aviso sai uma vez por ciclo ou por ocorrência. Pessoas desativadas no portal são
          ignoradas; se nenhuma restar, os administradores recebem.
        </p>
      </Card>
    </>
  );
}
