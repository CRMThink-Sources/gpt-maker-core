import type { Metadata } from 'next';
import { AdminProvider } from './admin-provider';

export const metadata: Metadata = { title: 'Backoffice ThinkFlow AI', robots: { index: false } };

/**
 * Backoffice interno (spec admin-backoffice, design D17): operadores com senha + TOTP, fora do
 * Bitrix. A API é chamada pelo repasse `/admin/api/*` do próprio frontend (cookie de primeira parte).
 */
export default function AdminLayout({ children }: LayoutProps<'/admin'>) {
  return <AdminProvider>{children}</AdminProvider>;
}
