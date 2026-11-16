import { AppFrame, Bar, FakeButton, MockWindow, type Screen } from './mock-ui';
import { Hotspot } from './tutorial-context';

const APP_URL = 'suaempresa.bitrix24.com.br/marketplace/app/gptthink/';

/** Passo 1: menu do app, com o item Créditos e plano em destaque. */
const openPlan: Screen = (ctx, target) => (
  <MockWindow url={APP_URL} label={ctx.t('start.screenLabel')}>
    <AppFrame ctx={ctx} active="agents" hotspotItem="plan" target={target}>
      <div className="space-y-2 rounded-lg bg-white p-4 ring-1 ring-zinc-200">
        <Bar className="w-1/3" />
        <Bar className="w-full" />
        <Bar className="w-3/4" />
      </div>
    </AppFrame>
  </MockWindow>
);

/** Passo 2: oferta de teste grátis, com Ativar teste grátis em destaque (sem valores). */
const trialOffer: Screen = (ctx, target) => {
  const plan = ctx.app('plan');
  return (
    <MockWindow url={APP_URL} label={ctx.t('start.screenLabel')}>
      <AppFrame ctx={ctx} active="plan">
        <p className="text-sm font-semibold text-zinc-900">{plan('title')}</p>
        <div className="mt-3 space-y-2 rounded-lg bg-brand-50 p-4 ring-1 ring-brand-200">
          <p className="font-semibold text-brand-800">{ctx.t('screens.plan.trialTitle')}</p>
          <p className="text-zinc-600">{ctx.t('screens.plan.trialText')}</p>
          <Hotspot label={target}>
            <FakeButton>{plan('trial.activate')}</FakeButton>
          </Hotspot>
        </div>
      </AppFrame>
    </MockWindow>
  );
};

/** Passo 3: saldo, com o total disponível em destaque (barras no lugar dos valores). */
const balance: Screen = (ctx, target) => {
  const plan = ctx.app('plan');
  return (
    <MockWindow url={APP_URL} label={ctx.t('start.screenLabel')}>
      <AppFrame ctx={ctx} active="plan">
        <p className="text-sm font-semibold text-zinc-900">{plan('title')}</p>
        <div className="mt-3 rounded-lg bg-white p-4 ring-1 ring-zinc-200">
          <p className="font-semibold text-zinc-900">{plan('balance.title')}</p>
          <div className="mt-2">
            <Hotspot label={target} className="block w-full">
              <span className="block rounded-md bg-brand-50 p-3">
                <span className="block text-zinc-500">{plan('balance.total')}</span>
                <span className="mt-1.5 block h-3 w-16 rounded bg-brand-200" />
              </span>
            </Hotspot>
          </div>
          <ul className="mt-3 space-y-1.5">
            {(['trial', 'plan', 'extra'] as const).map((key) => (
              <li key={key} className="flex items-center justify-between">
                <span className="text-zinc-500">{plan(`balance.${key}`)}</span>
                <Bar className="w-10" />
              </li>
            ))}
          </ul>
        </div>
      </AppFrame>
    </MockWindow>
  );
};

export const creditsScreens: [Screen, Screen, Screen] = [openPlan, trialOffer, balance];
