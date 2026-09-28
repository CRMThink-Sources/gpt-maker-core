'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { insideBitrix } from '@/lib/bx24';
import { ApiRequestError, type ClientConfig, PlatformSessionClient } from '@/lib/platform-session';

/** Resposta de `GET /app/session`. */
export interface AppSession {
  user: { id: string; name: string; isAdmin: boolean };
  tenant: { code: string; status: 'ACTIVE' | 'SUSPENDED' | 'AUTH_ERROR' | 'UNINSTALLED' };
  canManage: boolean;
}

interface SessionContextValue {
  session: AppSession;
  api: PlatformSessionClient['api'];
}

type State =
  | { kind: 'loading' }
  | { kind: 'outside' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; session: AppSession };

const SessionContext = createContext<SessionContextValue | null>(null);

export function useAppSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useAppSession fora do SessionProvider');
  return value;
}

const ERROR_MESSAGES: Record<string, string> = {
  INSTALLATION_NOT_ACTIVE: 'O app não está instalado neste portal. Reinstale pelo Bitrix24.',
  TENANT_NOT_INSTALLED: 'O app não está instalado neste portal. Reinstale pelo Bitrix24.',
  APP_INACTIVE: 'O app está temporariamente indisponível.',
  BITRIX_TOKEN_REJECTED: 'O Bitrix24 recusou a autenticação. Recarregue a página.',
};

export function SessionProvider({
  config,
  children,
}: {
  config: ClientConfig;
  children: ReactNode;
}) {
  const client = useMemo(() => new PlatformSessionClient(config), [config]);
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!insideBitrix()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- detectado só no navegador
      setState({ kind: 'outside' });
      return;
    }
    let cancelled = false;
    client
      .api<AppSession>('/app/session')
      .then((session) => !cancelled && setState({ kind: 'ready', session }))
      .catch((error: unknown) => {
        if (cancelled) return;
        const code = error instanceof ApiRequestError ? error.code : '';
        setState({
          kind: 'error',
          message:
            ERROR_MESSAGES[code] ?? 'Não foi possível abrir o app. Tente recarregar a página.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const value = useMemo(
    () =>
      state.kind === 'ready'
        ? { session: state.session, api: client.api.bind(client) as PlatformSessionClient['api'] }
        : null,
    [state, client],
  );

  if (state.kind === 'loading') return <p className="text-sm text-zinc-500">Carregando…</p>;
  if (state.kind === 'outside') {
    return <p className="text-sm text-zinc-600">Abra o app GPTMaker dentro do seu Bitrix24.</p>;
  }
  if (state.kind === 'error') return <p className="text-sm text-red-700">{state.message}</p>;

  return (
    <SessionContext.Provider value={value}>
      {state.session.tenant.status === 'AUTH_ERROR' && (
        <div
          role="alert"
          className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          O Bitrix24 recusou a autorização do app e o atendimento dos agentes está pausado. Um
          administrador do portal precisa reinstalar o app para restabelecer o acesso.
        </div>
      )}
      {children}
    </SessionContext.Provider>
  );
}
