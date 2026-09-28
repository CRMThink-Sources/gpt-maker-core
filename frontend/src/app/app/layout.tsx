import type { Metadata } from 'next';
import { connection } from 'next/server';
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
  };
  return (
    <main className="flex-1 p-6">
      <SessionProvider config={config}>{children}</SessionProvider>
    </main>
  );
}
