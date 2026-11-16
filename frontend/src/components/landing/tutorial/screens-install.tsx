import { Bar, Badge, FakeButton, MockWindow, type Screen } from './mock-ui';
import { Hotspot } from './tutorial-context';

const MARKET_URL = 'suaempresa.bitrix24.com.br/market/';

/** Logo do app na simulação (inicial sobre o violeta da marca). */
function Logo({ size = 'h-9 w-9' }: { size?: string }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white ${size}`}
    >
      G
    </span>
  );
}

function MarketBar({ brand, catalog }: { brand: string; catalog: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-2">
      <span className="text-sm font-bold text-sky-600">{brand}</span>
      <span className="rounded bg-sky-500 px-3 py-1 font-medium text-white">{catalog}</span>
      <span className="ml-auto w-32 rounded-full border border-sky-300 px-3 py-1 text-zinc-500">
        GPTThink
      </span>
    </div>
  );
}

/** Passo 1: busca no Market, com o card do app em destaque. */
const marketSearch: Screen = ({ t, app }, target) => (
  <MockWindow url={MARKET_URL} label={t('start.screenLabel')}>
    <MarketBar brand={t('screens.market.brand')} catalog={t('screens.market.catalog')} />
    <div className="p-4">
      <p className="text-sm font-semibold text-zinc-900">{t('screens.market.results')}</p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Hotspot label={target} className="block">
          <span className="block rounded-lg bg-white p-3 ring-1 ring-zinc-200">
            <span className="flex items-center gap-2">
              <Logo />
              <Badge tone="green">{t('screens.market.free')}</Badge>
            </span>
            <span className="mt-2 block text-xs font-semibold text-zinc-900">GPTThink</span>
            <span className="mt-1 block text-[10px] text-zinc-500">{app('shell')('tagline')}</span>
          </span>
        </Hotspot>
        {[0, 1].map((i) => (
          <div key={i} className="space-y-2 rounded-lg bg-white p-3 ring-1 ring-zinc-100">
            <span className="block h-9 w-9 rounded-lg bg-zinc-100" />
            <Bar className="w-3/4" />
            <Bar className="w-full" />
          </div>
        ))}
      </div>
    </div>
  </MockWindow>
);

/** Passo 2: página do app, com o botão Instalar em destaque. */
const marketApp: Screen = ({ t, app }, target) => (
  <MockWindow url={MARKET_URL} label={t('start.screenLabel')}>
    <MarketBar brand={t('screens.market.brand')} catalog={t('screens.market.catalog')} />
    <div className="p-4">
      <div className="flex items-start gap-3 rounded-lg bg-white p-4 ring-1 ring-zinc-200">
        <Logo size="h-14 w-14" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-zinc-900">GPTThink</p>
          <p className="text-zinc-500">{app('shell')('tagline')}</p>
          <div className="mt-3 flex items-center gap-3">
            <Hotspot label={target}>
              <FakeButton tone="success">{t('screens.market.install')}</FakeButton>
            </Hotspot>
            <Badge>{t('screens.market.free')}</Badge>
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 rounded-lg bg-white p-3 ring-1 ring-zinc-100">
        <div>
          <p className="text-[10px] text-zinc-400">{t('screens.market.developer')}</p>
          <p className="font-medium">CRMThink</p>
        </div>
        <Bar className="mt-4 w-2/3" />
        <Bar className="mt-4 w-1/2" />
      </div>
      <div className="mt-3 space-y-2">
        <Bar className="w-full" />
        <Bar className="w-5/6" />
      </div>
    </div>
  </MockWindow>
);

/** Passo 3: termos da instalação, com Concluir instalação em destaque. */
const installTerms: Screen = ({ t }, target) => (
  <MockWindow
    url="suaempresa.bitrix24.com.br/market/detail/gptthink/"
    label={t('start.screenLabel')}
  >
    <div className="flex h-full items-center justify-center p-4">
      <div className="w-64 overflow-hidden rounded-xl bg-white shadow ring-1 ring-zinc-200">
        <div className="bg-brand-600 px-4 py-3 text-white">
          <p className="text-sm font-semibold">{t('screens.install.title')}</p>
          <p className="mt-0.5 text-[10px] text-brand-100">{t('screens.install.subtitle')}</p>
        </div>
        <ul className="space-y-2 p-4">
          {(['termsMarket', 'termsLicense', 'termsPrivacy'] as const).map((key) => (
            <li key={key} className="flex items-center gap-2">
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-brand-600 text-[9px] text-white">
                ✓
              </span>
              <span className="text-zinc-600">{t(`screens.install.${key}`)}</span>
            </li>
          ))}
          <li className="pt-2">
            <Hotspot label={target} className="block w-full">
              <span className="block rounded-md bg-brand-600 py-2 text-center font-medium text-white">
                {t('screens.install.conclude')}
              </span>
            </Hotspot>
          </li>
        </ul>
      </div>
    </div>
  </MockWindow>
);

export const installScreens: [Screen, Screen, Screen] = [marketSearch, marketApp, installTerms];
