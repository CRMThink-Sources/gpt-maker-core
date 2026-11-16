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

/** Lista de treinamentos (itens de exemplo: um texto e um site, já processados). */
function TrainingList({ ctx }: { ctx: ScreenCtx }) {
  const trainings = ctx.app('trainings');
  return (
    <ul className="space-y-2">
      {(['TEXT', 'WEBSITE'] as const).map((type) => (
        <li
          key={type}
          className="flex items-center gap-3 rounded-lg bg-white p-3 ring-1 ring-zinc-200"
        >
          <Badge>{trainings(`types.${type}`)}</Badge>
          <Bar className="w-1/2" />
          <span className="ml-auto">
            <Badge tone="green">{trainings('status.done')}</Badge>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Passo 1: página do agente, com a aba Treinamentos em destaque. */
const openTrainings: Screen = (ctx, target) => (
  <MockWindow url={APP_URL} label={ctx.t('start.screenLabel')}>
    <AgentFrame ctx={ctx} active="function" hotspot="trainings" target={target}>
      <div className="space-y-2 rounded-lg bg-white p-4 ring-1 ring-zinc-200">
        <Bar className="w-1/3" />
        <Bar className="w-full" />
        <Bar className="w-5/6" />
        <Bar className="w-2/3" />
      </div>
    </AgentFrame>
  </MockWindow>
);

/** Passo 2: base de treinamentos, com Adicionar treinamento em destaque. */
const trainingsPage: Screen = (ctx, target) => {
  const trainings = ctx.app('trainings');
  return (
    <MockWindow url={APP_URL} label={ctx.t('start.screenLabel')}>
      <AgentFrame ctx={ctx} active="trainings">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-zinc-900">{trainings('page.heading')}</p>
            <p className="mt-0.5 text-zinc-500">{trainings('page.noCredits')}</p>
          </div>
          <Hotspot label={target}>
            <FakeButton>{trainings('page.add')}</FakeButton>
          </Hotspot>
        </div>
        <div className="mt-3">
          <TrainingList ctx={ctx} />
        </div>
      </AgentFrame>
    </MockWindow>
  );
};

/** Passo 3: com a base pronta, o botão Testar do agente em destaque. */
const testAgent: Screen = (ctx, target) => (
  <MockWindow url={APP_URL} label={ctx.t('start.screenLabel')}>
    <AgentFrame ctx={ctx} active="trainings" hotspot="test" target={target}>
      <TrainingList ctx={ctx} />
    </AgentFrame>
  </MockWindow>
);

export const trainScreens: [Screen, Screen, Screen] = [openTrainings, trainingsPage, testAgent];
