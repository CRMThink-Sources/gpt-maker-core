import { type FunctionTemplateContent, functionTemplateContentSchema } from '@gptmaker/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateAgentWizard } from './create-agent-wizard';

const api = vi.fn();
vi.mock('../session-provider', () => ({
  useAppSession: () => ({ session: { user: { isAdmin: true } }, api }),
}));
vi.mock('./use-transfer-agents', () => ({ useTransferAgents: () => [] }));

function makeForm(assist: boolean): FunctionTemplateContent {
  return functionTemplateContentSchema.parse({
    agentType: 'SUPPORT',
    profile: { jobName: 'Suporte' },
    behavior: 'Você é {{agente.nome}}. {{empresa.sobre}}',
    assist: { enabled: assist },
    fields: [
      {
        kind: 'TEXT',
        id: 'empresa.sobre',
        label: 'Sobre a empresa',
        required: false,
        maxLength: 300,
        multiline: true,
        ...(assist ? { assist: { questions: ['O que a empresa vende?'] } } : {}),
      },
    ],
  });
}

const FUNCTIONS = [
  { code: 'SUPPORT', name: 'Suporte', description: 'Atende', version: 1 },
  { code: 'SDR', name: 'SDR', description: 'Vende', version: 1 },
];
const ABOUT = 'Somos uma loja de bicicletas em Curitiba que atende por WhatsApp.';
const DRAFT = {
  fields: [
    { fieldId: 'empresa.sobre', value: 'Loja de bicicletas.', applicable: true, markers: 0 },
  ],
  credits: 1,
};

function route(forms: Record<string, boolean>, assistReply: unknown = DRAFT) {
  api.mockImplementation(async (path: string) => {
    if (path === '/app/agent-functions') return { functions: FUNCTIONS };
    if (path === '/app/models') {
      return { models: [{ id: 'm1', code: 'GPT', displayName: 'GPT', creditsPerResponse: 1 }] };
    }
    if (path === '/app/ai-key') {
      return {
        configured: false,
        last4: null,
        verifiedAt: null,
        creditsPerField: 1,
        platformAvailable: true,
      };
    }
    if (path.endsWith('/assist')) return assistReply;
    const code = decodeURIComponent(path.split('/').pop()!);
    if (forms[code] !== undefined) {
      return { ...FUNCTIONS.find((f) => f.code === code), form: makeForm(forms[code]!) };
    }
    throw new Error(`rota inesperada ${path}`);
  });
}

const next = () => screen.getByRole('button', { name: 'Avançar' }) as HTMLButtonElement;

async function chooseFunction(name: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name }));
  await waitFor(() => expect(next().disabled).toBe(false));
}

async function toFormStep(name: RegExp) {
  render(<CreateAgentWizard onClose={() => undefined} onCreated={() => undefined} />);
  await chooseFunction(name);
  fireEvent.click(next());
  fireEvent.change(await screen.findByLabelText(/Nome/), { target: { value: 'Ana' } });
  fireEvent.click(next());
}

beforeEach(() => {
  api.mockReset();
});
afterEach(cleanup);

describe('ajuda da IA no assistente de criação', () => {
  it('wizard: shows the button for a function with assist and an empty form', async () => {
    route({ SUPPORT: true, SDR: false });
    await toFormStep(/Suporte/);
    const button = (await screen.findByRole('button', {
      name: /Ajuda da IA/,
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('wizard: no button and no extra markup for a function without assist', async () => {
    route({ SUPPORT: true, SDR: false });
    await toFormStep(/SDR/);
    await screen.findByLabelText(/Sobre a empresa/);
    expect(screen.queryByRole('button', { name: /Ajuda da IA/ })).toBeNull();
    expect(screen.queryByText(/já estão preenchidos/)).toBeNull();
  });

  it('wizard: applying writes the value into the wizard answers and posts by function code', async () => {
    route({ SUPPORT: true, SDR: false });
    await toFormStep(/Suporte/);
    fireEvent.click(await screen.findByRole('button', { name: /Ajuda da IA/ }));
    fireEvent.change(screen.getByLabelText(/Fale da empresa/), { target: { value: ABOUT } });
    fireEvent.click(screen.getByRole('button', { name: 'Gerar' }));
    await screen.findByText('Loja de bicicletas.');
    expect(api.mock.calls.some(([path]) => path === '/app/agent-functions/SUPPORT/assist')).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    await waitFor(() =>
      expect((screen.getByLabelText(/Sobre a empresa/) as HTMLTextAreaElement).value).toBe(
        'Loja de bicicletas.',
      ),
    );
  });

  it('wizard: switching function discards drafts', async () => {
    route({ SUPPORT: true, SDR: true });
    await toFormStep(/Suporte/);
    fireEvent.click(await screen.findByRole('button', { name: /Ajuda da IA/ }));
    fireEvent.change(screen.getByLabelText(/Fale da empresa/), { target: { value: ABOUT } });
    fireEvent.click(screen.getByRole('button', { name: 'Gerar' }));
    await screen.findByText('Loja de bicicletas.');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    await chooseFunction(/SDR/);
    fireEvent.click(next());
    fireEvent.click(next());
    await screen.findByLabelText(/Sobre a empresa/);
    expect(screen.queryByText('Loja de bicicletas.')).toBeNull();
  });
});
