import { functionTemplateContentSchema } from '@gptmaker/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, useLocale } from '@/i18n';
import { CreateAgentWizard } from './create-agent-wizard';

// Formulário das funções no idioma da interface (spec function-template-i18n).
const api = vi.fn();
vi.mock('../session-provider', () => ({
  useAppSession: () => ({ session: { user: { isAdmin: true } }, api }),
}));
vi.mock('./use-transfer-agents', () => ({ useTransferAgents: () => [] }));

/** Idioma em que a "API" responde: o teste o muda antes de trocar o idioma da tela. */
let apiLocale: 'pt-BR' | 'en' = 'pt-BR';

const TEXT = {
  'pt-BR': { name: 'Suporte', description: 'Atende clientes', label: 'Sobre a empresa' },
  en: { name: 'Support', description: 'Serves customers', label: 'About the company' },
};

function form() {
  return functionTemplateContentSchema.parse({
    agentType: 'SUPPORT',
    profile: { jobName: 'Suporte' },
    behavior: 'Você é {{agente.nome}}. {{empresa.sobre}}',
    fields: [
      {
        kind: 'TEXT',
        id: 'empresa.sobre',
        label: TEXT[apiLocale].label,
        required: false,
        maxLength: 300,
        multiline: true,
      },
    ],
  });
}

function route() {
  api.mockImplementation(async (path: string) => {
    const t = TEXT[apiLocale];
    const fn = { code: 'SUPPORT', name: t.name, description: t.description, version: 1 };
    if (path === '/app/agent-functions') return { functions: [fn] };
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
    if (path === '/app/agent-functions/SUPPORT') return { ...fn, form: form() };
    throw new Error(`rota inesperada ${path}`);
  });
}

function SwitchToEnglish() {
  const { setLocale } = useLocale();
  return <button onClick={() => setLocale('en')}>to-en</button>;
}

beforeEach(() => {
  api.mockReset();
  apiLocale = 'pt-BR';
  route();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('assistente de criação ao trocar o idioma', () => {
  it('recarrega a lista e o formulário no novo idioma e mantém o que foi digitado', async () => {
    render(
      <I18nProvider>
        <SwitchToEnglish />
        <CreateAgentWizard onClose={() => undefined} onCreated={() => undefined} />
      </I18nProvider>,
    );
    // passo 1: a lista de funções vem em português
    const choose = await screen.findByRole('button', { name: /Suporte/ });
    fireEvent.click(choose);
    const next = () => screen.getByRole('button', { name: 'Avançar' }) as HTMLButtonElement;
    await waitFor(() => expect(next().disabled).toBe(false));
    fireEvent.click(next());
    // passo 2: nome do agente
    fireEvent.change(await screen.findByLabelText(/Nome/), { target: { value: 'Ana' } });
    fireEvent.click(next());
    // passo 3: o formulário da função, ainda em português
    const about = await screen.findByLabelText(/Sobre a empresa/);
    fireEvent.change(about, { target: { value: 'Loja de bicicletas' } });

    apiLocale = 'en';
    fireEvent.click(screen.getByText('to-en'));

    // o rótulo muda para o inglês e a resposta digitada continua lá
    const translated = await screen.findByLabelText(/About the company/);
    expect((translated as HTMLTextAreaElement).value).toBe('Loja de bicicletas');
    expect(api).toHaveBeenCalledWith('/app/agent-functions/SUPPORT');
  });
});
