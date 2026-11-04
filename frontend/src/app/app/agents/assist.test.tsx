import {
  type FunctionAnswers,
  type FunctionTemplateContent,
  functionTemplateContentSchema,
} from '@gptmaker/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/platform-session';
import { FunctionForm } from './function-form';
import type { Api } from './use-function-review';

afterEach(cleanup);

function makeForm(assistEnabled: boolean): FunctionTemplateContent {
  return functionTemplateContentSchema.parse({
    agentType: 'SUPPORT',
    profile: { jobName: 'Suporte' },
    behavior: 'Você é {{agente.nome}}. {{empresa.sobre}}',
    assist: { enabled: assistEnabled },
    fields: [
      {
        kind: 'TEXT',
        id: 'empresa.sobre',
        label: 'Sobre a empresa',
        required: false,
        maxLength: 300,
        multiline: true,
        assist: { questions: ['O que a empresa vende?', 'Quem compra?'] },
      },
    ],
  });
}

const aiKey = {
  configured: false,
  last4: null,
  verifiedAt: null,
  creditsPerField: 1,
  platformAvailable: true,
};

function Harness({
  form,
  api,
  initial = {},
}: {
  form: FunctionTemplateContent;
  api?: unknown;
  initial?: FunctionAnswers;
}) {
  const [answers, setAnswers] = useState(initial);
  return (
    <FunctionForm
      form={form}
      answers={answers}
      onChange={setAnswers}
      assist={
        api ? { api: api as Api, endpoint: '/app/agents/a1/function/assist', aiKey } : undefined
      }
    />
  );
}

const ABOUT = 'Somos uma loja de bicicletas em Curitiba que atende por WhatsApp.';

function generate() {
  fireEvent.click(screen.getByRole('button', { name: /Ajuda da IA/ }));
  fireEvent.change(screen.getByLabelText(/Fale da empresa/), { target: { value: ABOUT } });
  fireEvent.click(screen.getByRole('button', { name: 'Gerar' }));
}

const okResult = (over = {}) => ({
  fields: [
    {
      fieldId: 'empresa.sobre',
      value: 'Loja de bicicletas.',
      applicable: true,
      markers: 0,
      ...over,
    },
  ],
  credits: 2,
});

describe('ajuda da IA no formulário', () => {
  it('button is disabled with a reason when assist is configured but no field is empty', () => {
    render(
      <Harness form={makeForm(true)} api={vi.fn()} initial={{ 'empresa.sobre': 'escrito' }} />,
    );
    const button = screen.getByRole('button', { name: /Ajuda da IA/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('Todos os campos com ajuda já estão preenchidos')).toBeTruthy();
  });

  it('nothing renders when assist is not configured', () => {
    const { container } = render(<Harness form={makeForm(false)} api={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Ajuda da IA/ })).toBeNull();
    expect(container.textContent).not.toContain('Ajuda da IA');
    expect(container.textContent).not.toContain('já estão preenchidos');
  });

  it('the hook posts to the given endpoint', async () => {
    const api = vi.fn(async () => okResult());
    render(<Harness form={makeForm(true)} api={api} />);
    generate();
    await screen.findByText('Loja de bicicletas.');
    expect((api.mock.calls[0] as unknown[])[0]).toBe('/app/agents/a1/function/assist');
  });

  it('button is hidden when assist is disabled', () => {
    render(<Harness form={makeForm(false)} api={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Ajuda da IA/ })).toBeNull();
  });

  it('form without assist renders as before', () => {
    render(<Harness form={makeForm(true)} />);
    expect(screen.queryByRole('button', { name: /Ajuda da IA/ })).toBeNull();
    expect(screen.getByLabelText(/Sobre a empresa/)).toBeTruthy();
  });

  it('about shorter than 20 characters blocks generating', () => {
    const api = vi.fn();
    render(<Harness form={makeForm(true)} api={api} />);
    fireEvent.click(screen.getByRole('button', { name: /Ajuda da IA/ }));
    fireEvent.change(screen.getByLabelText(/Fale da empresa/), { target: { value: 'curto' } });
    expect((screen.getByRole('button', { name: 'Gerar' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText('O que a empresa vende?')).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });

  it('apply writes the value into answers', async () => {
    const api = vi.fn(async (path: string, init?: RequestInit) => ({ ...okResult(), path, init }));
    render(<Harness form={makeForm(true)} api={api} />);
    fireEvent.click(screen.getByRole('button', { name: /Ajuda da IA/ }));
    fireEvent.change(screen.getByLabelText('O que a empresa vende?'), {
      target: { value: 'Bicicletas' },
    });
    fireEvent.change(screen.getByLabelText(/Fale da empresa/), { target: { value: ABOUT } });
    fireEvent.click(screen.getByRole('button', { name: 'Gerar' }));
    await screen.findByText('Loja de bicicletas.');
    const body = JSON.parse(String(api.mock.calls[0]![1]!.body));
    expect(body.fieldIds).toEqual(['empresa.sobre']);
    expect(body.interview).toEqual([
      {
        fieldId: 'empresa.sobre',
        answers: [{ question: 'O que a empresa vende?', answer: 'Bicicletas' }],
      },
    ]);
    expect(screen.getByText(/2 créditos/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    await waitFor(() =>
      expect((screen.getByLabelText(/Sobre a empresa/) as HTMLTextAreaElement).value).toBe(
        'Loja de bicicletas.',
      ),
    );
  });

  it('not applicable result disables apply and shows why', async () => {
    render(
      <Harness form={makeForm(true)} api={vi.fn(async () => okResult({ applicable: false }))} />,
    );
    generate();
    await screen.findByText('Loja de bicicletas.');
    expect((screen.getByRole('button', { name: 'Aplicar' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/passa dos limites do campo/)).toBeTruthy();
  });

  it('only-marker result warns that it is a skeleton and still allows apply', async () => {
    const api = vi.fn(async () => okResult({ value: '[preencher: nome da loja]', markers: 1 }));
    render(<Harness form={makeForm(true)} api={api} />);
    generate();
    await screen.findByText(/apenas um esqueleto/);
    expect(screen.getByText(/1 trecho/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Aplicar' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('discard removes the field from the panel', async () => {
    render(<Harness form={makeForm(true)} api={vi.fn(async () => okResult())} />);
    generate();
    await screen.findByText('Loja de bicicletas.');
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(screen.queryByText('Loja de bicicletas.')).toBeNull();
  });

  it('error shows a message and allows trying again', async () => {
    const api = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiRequestError(502, 'AI_BAD_OUTPUT', 'A IA devolveu algo inválido.'),
      )
      .mockResolvedValueOnce(okResult());
    render(<Harness form={makeForm(true)} api={api} />);
    generate();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'A IA devolveu algo inválido.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Gerar' }));
    await screen.findByText('Loja de bicicletas.');
  });
});
