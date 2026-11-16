import { Bar, FakeButton, MockWindow, type ScreenCtx, type Screen } from './mock-ui';
import { Hotspot } from './tutorial-context';

const CONTACT_URL = 'suaempresa.bitrix24.com.br/contact_center/';
const LINE_URL = 'suaempresa.bitrix24.com.br/contact_center/lines/';

function Topbar({ ctx }: { ctx: ScreenCtx }) {
  return (
    <div className="border-b border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-sky-700">
      {ctx.t('screens.contact.title')}
    </div>
  );
}

/** Passo 1: Contact Center, com o bloco Canais abertos em destaque. */
const contactCenter: Screen = (ctx, target) => (
  <MockWindow url={CONTACT_URL} label={ctx.t('start.screenLabel')}>
    <Topbar ctx={ctx} />
    <div className="grid grid-cols-3 gap-3 p-4">
      <Hotspot label={target} className="block">
        <span className="block rounded-lg bg-white p-3 ring-1 ring-zinc-200">
          <span className="block h-8 w-8 rounded-md bg-sky-500" />
          <span className="mt-2 block font-semibold text-zinc-900">
            {ctx.t('screens.contact.openChannels')}
          </span>
          <span className="mt-1 block h-2 w-3/4 rounded bg-zinc-200" />
        </span>
      </Hotspot>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="space-y-2 rounded-lg bg-white p-3 ring-1 ring-zinc-100">
          <span className="block h-8 w-8 rounded-md bg-zinc-100" />
          <Bar className="w-3/4" />
          <Bar className="w-1/2" />
        </div>
      ))}
    </div>
  </MockWindow>
);

/** Formulário do canal aberto; o campo Chatbot muda conforme o passo. */
function LineForm({
  ctx,
  chatbot,
  footer,
}: {
  ctx: ScreenCtx;
  chatbot: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <>
      <Topbar ctx={ctx} />
      <div className="space-y-3 p-4">
        <p className="text-sm font-semibold text-zinc-900">{ctx.t('screens.contact.lineTitle')}</p>
        <div className="space-y-2 rounded-lg bg-white p-3 ring-1 ring-zinc-200">
          <Bar className="w-1/3" />
          <Bar className="w-full" />
        </div>
        <div className="rounded-lg bg-white p-3 ring-1 ring-zinc-200">
          <p className="mb-1.5 font-medium text-zinc-900">{ctx.t('screens.contact.chatbot')}</p>
          {chatbot}
        </div>
        <div className="flex justify-end">{footer}</div>
      </div>
    </>
  );
}

function Select({ children }: { children?: React.ReactNode }) {
  return (
    <span className="flex items-center justify-between rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-zinc-600">
      {children}
      <span aria-hidden="true">▾</span>
    </span>
  );
}

/** Passo 2: configurações da linha, com o campo Chatbot em destaque. */
const pickChatbot: Screen = (ctx, target) => (
  <MockWindow url={LINE_URL} label={ctx.t('start.screenLabel')}>
    <LineForm
      ctx={ctx}
      chatbot={
        <Hotspot label={target} className="block w-full">
          <Select>{ctx.t('screens.contact.chatbotPlaceholder')}</Select>
        </Hotspot>
      }
      footer={<FakeButton tone="ghost">{ctx.t('screens.contact.save')}</FakeButton>}
    />
  </MockWindow>
);

/** Passo 3: agente escolhido, com Salvar em destaque. */
const saveLine: Screen = (ctx, target) => (
  <MockWindow url={LINE_URL} label={ctx.t('start.screenLabel')}>
    <LineForm
      ctx={ctx}
      chatbot={<Select>{ctx.t('screens.sample.agentName')}</Select>}
      footer={
        <Hotspot label={target}>
          <FakeButton>{ctx.t('screens.contact.save')}</FakeButton>
        </Hotspot>
      }
    />
  </MockWindow>
);

export const channelScreens: [Screen, Screen, Screen] = [contactCenter, pickChatbot, saveLine];
