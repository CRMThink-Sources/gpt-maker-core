import type { Metadata } from 'next';
import { connection } from 'next/server';
import { AppShell } from './app-shell';
import { SessionProvider } from './session-provider';

export const metadata: Metadata = { title: 'GPTMaker' };

/**
 * Área do cliente, carregada no iframe do Bitrix24. URLs lidas em tempo de execução (mesma
 * imagem em staging e produção), por isso a renderização é dinâmica.
 */
export default async function ClientAppLayout({ children }: LayoutProps<'/app'>) {
  await connection();
  const config = {
    platformUrl: process.env.PUBLIC_PLATFORM_URL ?? 'https://platform-staging.crmthink.com.br',
    apiBaseUrl: process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3001',
    stripePublishableKey: process.env.PUBLIC_STRIPE_PUBLISHABLE_KEY || null,
  };
  return (
    <SessionProvider config={config}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
