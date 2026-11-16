'use client';

import type { Locale } from '@gptmaker/contracts';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LogoMark } from '@/components/logo';
import { useT } from '@/i18n';
import { Spinner } from '@/components/ui';
import { insideBitrix } from '@/lib/bx24';
import { ApiRequestError, type ClientConfig, PlatformSessionClient } from '@/lib/platform-session';

/** Resposta de `GET /app/session`. */
export interface AppSession {
  user: { id: string; name: string; isAdmin: boolean };
  tenant: {
    code: string;
    status: 'ACTIVE' | 'SUSPENDED' | 'AUTH_ERROR' | 'UNINSTALLED';
    locale: Locale;
  };
  canManage: boolean;
  /** Recursos ligados no ambiente. */
  features?: { crmTools?: boolean };
}

interface SessionContextValue {
  session: AppSession;
  api: PlatformSessionClient['api'];
  config: ClientConfig;
}

type State =
  | { kind: 'loading' }
  | { kind: 'outside' }
  | { kind: 'error'; code: string }
  | { kind: 'ready'; session: AppSession };

const SessionContext = createContext<SessionContextValue | null>(null);

export function useAppSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useAppSession fora do SessionProvider');
  return value;
}

/** Códigos com texto próprio em `session.errors`; os demais caem na mensagem genérica. */
const KNOWN_ERRORS = new Set([
  'INSTALLATION_NOT_ACTIVE',
  'TENANT_NOT_INSTALLED',
  'APP_INACTIVE',
  'BITRIX_TOKEN_REJECTED',
]);

export function SessionProvider({
  config,
  children,
}: {
  config: ClientConfig;
  children: ReactNode;
}) {
  const client = useMemo(() => new PlatformSessionClient(config), [config]);
  const t = useT('session');
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
        setState({ kind: 'error', code });
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const value = useMemo(
    () =>
      state.kind === 'ready'
        ? {
            session: state.session,
            api: client.api.bind(client) as PlatformSessionClient['api'],
            config,
          }
        : null,
    [state, client, config],
  );

  if (state.kind === 'loading') {
    return (
      <Splash>
        <Spinner className="size-6" />
        <p className="text-sm text-zinc-500">{t('connecting')}</p>
      </Splash>
    );
  }
  if (state.kind === 'outside') {
    return (
      <Splash>
        <p className="font-medium text-zinc-900">{t('openFromBitrix')}</p>
        <p className="text-sm text-zinc-500">{t('openFromBitrixHint')}</p>
      </Splash>
    );
  }
  if (state.kind === 'error') {
    return (
      <Splash>
        <p className="font-medium text-zinc-900">{t('cannotOpen')}</p>
        <p className="text-sm text-red-700">
          {KNOWN_ERRORS.has(state.code) ? t(`errors.${state.code}`) : t('cannotOpenRetry')}
        </p>
      </Splash>
    );
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Tela cheia centralizada para os estados antes da sessão (sem o aside). */
function Splash({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-1 items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <LogoMark className="mb-2 size-12" />
        {children}
      </div>
    </div>
  );
}
