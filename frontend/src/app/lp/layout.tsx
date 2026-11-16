import { Inter, Montserrat } from 'next/font/google';

// Mesmo par de fontes das LPs dos outros apps da CRMThink (ex.: ThinkZap): Montserrat nos títulos
// e Inter no texto. Carregadas só nas rotas `/lp`; o `/app` e o `/admin` seguem com fonte do sistema.
const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-montserrat',
  display: 'swap',
});
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export default function LpLayout({ children }: LayoutProps<'/lp'>) {
  return <div className={`${montserrat.variable} ${inter.variable} font-lp-body`}>{children}</div>;
}
