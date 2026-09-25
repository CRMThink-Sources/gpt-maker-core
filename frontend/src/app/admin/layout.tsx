import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Backoffice GPTMaker', robots: { index: false } };

/** Backoffice interno (autenticação de operadores na seção 15). */
export default function AdminLayout({ children }: LayoutProps<'/admin'>) {
  return <main className="flex-1 p-6">{children}</main>;
}
