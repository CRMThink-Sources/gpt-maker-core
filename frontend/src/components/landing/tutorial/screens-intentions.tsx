import {
  AgentFrame,
  Bar,
  Badge,
  FakeButton,
  MockWindow,
  type ScreenCtx,
  type Screen,
} from './mock-ui';
import { Hotspot } from './tutorial-context';

const APP_URL = 'suaempresa.bitrix24.com.br/marketplace/app/gptthink/';

/** Passo 1: página do agente, com a aba Intenções em destaque. */
const openIntentions: Screen = (ctx, target) => (
  <MockWindow url={APP_URL} label={ctx.t('start.screenLabel')}>
    <AgentFrame ctx={ctx} active="function" hotspot="intentions" target={target}>
      <div className="space-y-2 rounded-lg bg-white p-4 ring-1 ring-zinc-200">
        <Bar className="w-1/3" />
        <Bar className="w-full" />
        <Bar className="w-5/6" />
      </div>
    </AgentFrame>
  </MockWindow>
);

/** Cartão de uma intenção; `active` define o selo e `action` é o botão da direita. */
function IntentionCard({
  ctx,
  active,
  action,
}: {
  ctx: ScreenCtx;
  active: boolean;
  action: React.ReactNode;
}) {
  const intentions = ctx.app('intentions');
  return (
    <div className="space-y-2 rounded-lg bg-white p-3 ring-1 ring-zinc-200">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-zinc-900">{ctx.t('screens.sample.intentionName')}</span>
        <Badge tone={active ? 'green' : 'zinc'}>
          {active ? intentions('page.active') : intentions('page.inactive')}
        </Badge>
        <Badge>{intentions('page.fromFunction')}</Badge>
      </div>
      <p className="text-zinc-500">
        {intentions('page.collects')} {ctx.t('screens.sample.intentionFields')}
      </p>
      <div className="flex items-center gap-2">
        <FakeButton tone="ghost">{intentions('page.history')}</FakeButton>
        <FakeButton tone="ghost">{intentions('page.edit')}</FakeButton>
        <span className="ml-auto">{action}</span>
      </div>
    </div>
  );
}

/** Passo 2: lista de intenções, com Nova intenção em destaque. */
const intentionsPage: Screen = (ctx, target) => {
  const intentions = ctx.app('intentions');
  return (
    <MockWindow url={APP_URL} label={ctx.t('start.screenLabel')}>
      <AgentFrame ctx={ctx} active="intentions">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-zinc-900">{intentions('page.title')}</p>
          <Hotspot label={target}>
            <FakeButton>{intentions('page.new')}</FakeButton>
          </Hotspot>
        </div>
        <div className="mt-3">
          <IntentionCard
            ctx={ctx}
            active
            action={<FakeButton tone="ghost">{intentions('page.deactivate')}</FakeButton>}
          />
        </div>
      </AgentFrame>
    </MockWindow>
  );
};

/** Passo 3: intenção desativada, com Ativar em destaque. */
const activateIntention: Screen = (ctx, target) => {
  const intentions = ctx.app('intentions');
  return (
    <MockWindow url={APP_URL} label={ctx.t('start.screenLabel')}>
      <AgentFrame ctx={ctx} active="intentions">
        <p className="font-semibold text-zinc-900">{intentions('page.title')}</p>
        <div className="mt-3">
          <IntentionCard
            ctx={ctx}
            active={false}
            action={
              <Hotspot label={target}>
                <FakeButton>{intentions('page.activate')}</FakeButton>
              </Hotspot>
            }
          />
        </div>
      </AgentFrame>
    </MockWindow>
  );
};

export const intentionsScreens: [Screen, Screen, Screen] = [
  openIntentions,
  intentionsPage,
  activateIntention,
];
