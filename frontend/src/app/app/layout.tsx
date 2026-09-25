import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'GPTMaker' };

/** Área do cliente, carregada no iframe do Bitrix24 (sessão via crmthink-platform na seção 6). */
export default function ClientAppLayout({ children }: LayoutProps<'/app'>) {
  return <main className="flex-1 p-6">{children}</main>;
}
