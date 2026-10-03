import type { Metadata } from 'next';
import { connection } from 'next/server';
import { AdminProvider } from './admin-provider';

export const metadata: Metadata = { title: 'Backoffice ThinkFlow AI', robots: { index: false } };

/**
 * Backoffice interno (spec admin-backoffice, design D17): operadores com senha + TOTP, fora do
 * Bitrix. URL da API lida em tempo de execução, como na área do app.
 */
export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  await connection();
  const apiBaseUrl = process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
  return <AdminProvider apiBaseUrl={apiBaseUrl}>{children}</AdminProvider>;
}
