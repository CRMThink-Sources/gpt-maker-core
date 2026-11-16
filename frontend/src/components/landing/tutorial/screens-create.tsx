import {
  AppFrame,
  Bar,
  Badge,
  FakeButton,
  MockWindow,
  type ScreenCtx,
  type Screen,
} from './mock-ui';
import { Hotspot } from './tutorial-context';

const APP_URL = 'suaempresa.bitrix24.com.br/marketplace/app/gptthink/';

/** Passo 1: lista de agentes vazia, com Novo agente em destaque. */
const agentsEmpty: Screen = (ctx, target) => {
  const home = ctx.app('home');
  return (
    <MockWindow url={APP_URL} label={ctx.t('start.screenLabel')}>
      <AppFrame ctx={ctx} active="agents">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-zinc-900">{home('title')}</p>
          <Hotspot label={target}>
            <FakeButton>{home('newAgent')}</FakeButton>
          </Hotspot>
        </div>
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center">
          <p className="font-semibold text-zinc-900">{home('empty.title')}</p>
          <p className="mx-auto mt-1 max-w-56 text-zinc-500">{home('empty.descriptionManage')}</p>
        </div>
      </AppFrame>
    </MockWindow>
  );
};

/** Etapas do assistente "Novo agente"; `current` é a que está aberta (1 a 4). */
function Stepper({ ctx, current }: { ctx: ScreenCtx; current: number }) {
  const form = ctx.app('agentForm');
  const steps = ['function', 'identity', 'form', 'preview'] as const;
  return (
    <ol className="flex gap-3">
      {steps.map((key, i) => (
        <li
          key={key}
          className={`flex items-center gap-1.5 ${i + 1 === current ? 'font-semibold text-brand-700' : 'text-zinc-400'}`}
        >
          <span
            className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${
              i + 1 <= current ? 'bg-brand-600 text-white' : 'bg-zinc-200'
            }`}
          >
            {i + 1}
          </span>
          {form(`wizard.steps.${key}.title`)}
        </li>
      ))}
    </ol>
  );
}

/** Passo 2: escolha da função, com Avançar em destaque. */
const wizardFunction: Screen = (ctx, target) => {
  const form = ctx.app('agentForm');
  return (
    <MockWindow url={APP_URL} label={ctx.t('start.screenLabel')}>
      <AppFrame ctx={ctx} active="agents">
        <p className="text-sm font-semibold text-zinc-900">{form('wizard.title')}</p>
        <div className="mt-3">
          <Stepper ctx={ctx} current={1} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {(['fnSupport', 'fnSdr', 'fnScheduling'] as const).map((key, i) => (
            <div
              key={key}
              className={`space-y-2 rounded-lg bg-white p-3 ${
                i === 0 ? 'ring-2 ring-brand-600' : 'ring-1 ring-zinc-200'
              }`}
            >
              <p className="font-semibold text-zinc-900">{ctx.t(`screens.sample.${key}`)}</p>
              <Bar className="w-full" />
              <Bar className="w-2/3" />
            </div>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <FakeButton tone="ghost">{form('wizard.cancel')}</FakeButton>
          <Hotspot label={target}>
            <FakeButton>{form('wizard.next')}</FakeButton>
          </Hotspot>
        </div>
      </AppFrame>
    </MockWindow>
  );
};

/** Passo 3: prévia do que será criado, com Criar agente em destaque. */
const wizardPreview: Screen = (ctx, target) => {
  const form = ctx.app('agentForm');
  return (
    <MockWindow url={APP_URL} label={ctx.t('start.screenLabel')}>
      <AppFrame ctx={ctx} active="agents">
        <p className="text-sm font-semibold text-zinc-900">{form('wizard.title')}</p>
        <div className="mt-3">
          <Stepper ctx={ctx} current={4} />
        </div>
        <div className="mt-4 space-y-2 rounded-lg bg-white p-4 ring-1 ring-zinc-200">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-900">
              {ctx.t('screens.sample.agentName')}
            </span>
            <Badge>{ctx.t('screens.sample.fnSupport')}</Badge>
          </div>
          <p className="text-zinc-500">{form('sections.model.title')}</p>
          <Bar className="w-1/2" />
          <Bar className="w-full" />
          <Bar className="w-3/4" />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <FakeButton tone="ghost">{form('wizard.back')}</FakeButton>
          <Hotspot label={target}>
            <FakeButton>{form('wizard.create')}</FakeButton>
          </Hotspot>
        </div>
      </AppFrame>
    </MockWindow>
  );
};

export const createScreens: [Screen, Screen, Screen] = [agentsEmpty, wizardFunction, wizardPreview];
