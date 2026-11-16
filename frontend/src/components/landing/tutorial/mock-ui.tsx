import { Fragment, type ReactNode } from 'react';
import type { LandingT } from '../landing-t';
import { Hotspot } from './tutorial-context';

/** Contexto que cada tela simulada recebe: textos da LP e textos reais do app (mesmo idioma). */
export interface ScreenCtx {
  t: LandingT;
  app: (
    namespace: 'shell' | 'home' | 'agentForm' | 'agentDetail' | 'trainings' | 'intentions' | 'plan',
  ) => LandingT;
}

/** Uma tela por passo; `target` é o nome do elemento que recebe o destaque laranja. */
export type Screen = (ctx: ScreenCtx, target: string) => ReactNode;

/** Janela de navegador (as três bolinhas e a barra de endereço) que emoldura a tela simulada. */
export function MockWindow({
  url,
  label,
  children,
}: {
  url: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-zinc-200"
    >
      <div className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-100 px-3 py-2">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
        <span className="min-w-0 flex-1 truncate rounded bg-white px-3 py-1 text-[11px] text-zinc-500">
          {url}
        </span>
      </div>
      <div className="h-80 overflow-hidden bg-zinc-50 text-[11px] leading-snug text-zinc-700">
        {children}
      </div>
    </div>
  );
}

/** Barra cinza que representa texto sem importância na simulação. */
export function Bar({ className = 'w-full' }: { className?: string }) {
  return <span className={`block h-2 rounded bg-zinc-200 ${className}`} />;
}

const TONES = {
  primary: 'bg-brand-600 text-white',
  success: 'bg-lime-500 text-white',
  ghost: 'bg-white text-zinc-700 ring-1 ring-zinc-300',
} as const;

/** Botão desenhado (não interativo); o que o visitante clica é o `Hotspot` que o envolve. */
export function FakeButton({
  children,
  tone = 'primary',
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
}) {
  return (
    <span className={`inline-block rounded-md px-3 py-1.5 text-[11px] font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Badge({
  children,
  tone = 'zinc',
}: {
  children: ReactNode;
  tone?: 'zinc' | 'green';
}) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
        tone === 'green' ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600'
      }`}
    >
      {children}
    </span>
  );
}

const MENU = ['agents', 'crm', 'plan', 'settings'] as const;
type MenuKey = (typeof MENU)[number];

/**
 * O app GPTThink dentro do Bitrix24: menu lateral e área principal. `hotspotItem` põe o destaque
 * num item do menu.
 */
export function AppFrame({
  ctx,
  active,
  hotspotItem,
  target,
  children,
}: {
  ctx: ScreenCtx;
  active: MenuKey;
  hotspotItem?: MenuKey;
  target?: string;
  children: ReactNode;
}) {
  const shell = ctx.app('shell');
  return (
    <div className="flex h-full">
      <div className="w-36 shrink-0 border-r border-zinc-200 bg-white p-3">
        <p className="text-sm font-bold text-brand-700">GPTThink</p>
        <p className="mt-0.5 text-[10px] text-zinc-400">{shell('tagline')}</p>
        <ul className="mt-4 space-y-1">
          {MENU.map((key) => {
            const item = (
              <span
                className={`block rounded-md px-2 py-1.5 ${
                  key === active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-zinc-600'
                }`}
              >
                {shell(key)}
              </span>
            );
            return (
              <li key={key}>
                {key === hotspotItem && target ? (
                  <Hotspot label={target} className="block w-full">
                    {item}
                  </Hotspot>
                ) : (
                  item
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="min-w-0 flex-1 overflow-hidden p-4">{children}</div>
    </div>
  );
}

const AGENT_TABS = ['function', 'settings', 'trainings', 'intentions', 'triggers'] as const;
type AgentTab = (typeof AGENT_TABS)[number];

/**
 * Página de um agente: cabeçalho (nome, status, Testar) e as abas Função, Configurações,
 * Treinamentos, Intenções e Gatilhos. O destaque pode estar numa aba ou no botão Testar.
 */
export function AgentFrame({
  ctx,
  active,
  hotspot,
  target,
  children,
}: {
  ctx: ScreenCtx;
  active: AgentTab;
  hotspot?: AgentTab | 'test';
  target?: string;
  children: ReactNode;
}) {
  const detail = ctx.app('agentDetail');
  const wrap = (key: AgentTab | 'test', node: ReactNode) =>
    key === hotspot && target ? <Hotspot label={target}>{node}</Hotspot> : node;
  return (
    <AppFrame ctx={ctx} active="agents">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-900">
            {ctx.t('screens.sample.agentName')}
          </span>
          <Badge tone="green">{detail('status.active')}</Badge>
        </div>
        {wrap('test', <FakeButton tone="ghost">{detail('layout.test')}</FakeButton>)}
      </div>
      <div className="mt-3 flex gap-1 border-b border-zinc-200 pb-2">
        {AGENT_TABS.map((key) => (
          <Fragment key={key}>
            {wrap(
              key,
              <span
                className={`block rounded-md px-2 py-1 ${
                  key === active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-zinc-600'
                }`}
              >
                {detail(`layout.tabs.${key}`)}
              </span>,
            )}
          </Fragment>
        ))}
      </div>
      <div className="mt-4">{children}</div>
    </AppFrame>
  );
}
