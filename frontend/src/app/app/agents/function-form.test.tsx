import {
  compileAgent,
  type FunctionAnswers,
  functionTemplateContentSchema,
  validateFunctionAnswers,
} from '@gptmaker/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { BehaviorMeter, FunctionForm, isAnswered } from './function-form';

// Formulário mínimo: um texto e uma escolha com campo dependente (spec agent-function-templates).
const form = functionTemplateContentSchema.parse({
  agentType: 'SUPPORT',
  profile: { jobName: '{{empresa.nome}}' },
  fields: [
    { kind: 'TEXT', id: 'empresa.nome', label: 'Nome da empresa', required: true, maxLength: 80 },
    {
      kind: 'CHOICE',
      id: 'teste.suporte',
      label: 'Cliente pedindo suporte',
      required: true,
      options: [
        { value: 'transferir', label: 'Transferir', snippet: 'Transfira para um atendente.' },
        {
          value: 'canal',
          label: 'Informar o canal',
          snippet: 'Oriente a falar pelo {{teste.canal}}.',
          dependents: [
            {
              kind: 'TEXT',
              id: 'teste.canal',
              label: 'Qual o canal?',
              required: true,
              maxLength: 100,
            },
          ],
        },
      ],
    },
  ],
  behavior: 'Você é {{agente.nome}}, da {{empresa.nome}}.\n{{teste.suporte}}',
});

/** O formulário como o assistente o usa: respostas no estado, contador e problemas ao vivo. */
function Harness() {
  const [answers, setAnswers] = useState<FunctionAnswers>({});
  const { issues } = validateFunctionAnswers(form, answers);
  return (
    <>
      <BehaviorMeter form={form} answers={answers} agentName="Ana" />
      <FunctionForm form={form} answers={answers} onChange={setAnswers} issues={issues} />
    </>
  );
}

/** Número que o contador mostra. */
function meter(): number {
  const text = screen.getByText(/de 3000 caracteres/).textContent ?? '';
  return Number(/^(\d+) de/.exec(text)?.[1]);
}

/** O que o compilador dá para as mesmas respostas (o número que será publicado). */
function compiled(answers: FunctionAnswers): number {
  return compileAgent({ content: form, answers, agentName: 'Ana', mode: 'SIMPLE' }).behavior.length;
}

const type = (name: RegExp, value: string) =>
  fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });

afterEach(cleanup);

describe('formulário da função', () => {
  it('mostra e exige o dependente só com a opção dele escolhida', () => {
    render(<Harness />);
    expect(screen.queryByRole('textbox', { name: /^Qual o canal\?/ })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Informar o canal' }));
    expect(screen.getByRole('textbox', { name: /^Qual o canal\?/ })).toBeTruthy();
    // Obrigatório e vazio: o problema aparece no próprio campo.
    expect(
      screen.getByRole('textbox', { name: /^Qual o canal\?/ }).parentElement?.textContent,
    ).toContain('campo obrigatório');

    fireEvent.click(screen.getByRole('radio', { name: 'Transferir' }));
    expect(screen.queryByRole('textbox', { name: /^Qual o canal\?/ })).toBeNull();
  });

  it('o contador acompanha as respostas com o mesmo número do compilador', () => {
    render(<Harness />);
    expect(meter()).toBe(compiled({}));

    type(/^Nome da empresa/, 'Acme');
    expect(meter()).toBe(compiled({ 'empresa.nome': 'Acme' }));

    fireEvent.click(screen.getByRole('radio', { name: 'Informar o canal' }));
    type(/^Qual o canal\?/, 'WhatsApp');
    const withChannel = {
      'empresa.nome': 'Acme',
      'teste.suporte': 'canal',
      'teste.canal': 'WhatsApp',
    };
    expect(meter()).toBe(compiled(withChannel));

    // Trocar de opção tira o trecho e o dependente da conta.
    fireEvent.click(screen.getByRole('radio', { name: 'Transferir' }));
    expect(meter()).toBe(compiled({ 'empresa.nome': 'Acme', 'teste.suporte': 'transferir' }));
  });
});

describe('vários usuários, canal aberto e agente (D15–D17)', () => {
  const AGENT_B = '0b6f7a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
  const extra = functionTemplateContentSchema.parse({
    agentType: 'SUPPORT',
    profile: {},
    fields: [
      {
        kind: 'BITRIX_USER',
        id: 'teste.vendedores',
        label: 'Vendedores',
        required: true,
        multiple: true,
      },
      { kind: 'BITRIX_OPENLINE', id: 'teste.canal_aberto', label: 'Canal aberto', required: true },
      { kind: 'AGENT', id: 'teste.agente', label: 'Agente de vendas', required: true },
    ],
    behavior: 'Você é {{agente.nome}}.',
  });

  function ExtraHarness({ onAnswers }: { onAnswers: (answers: FunctionAnswers) => void }) {
    const [answers, setAnswers] = useState<FunctionAnswers>({});
    return (
      <FunctionForm
        form={extra}
        answers={answers}
        agents={[{ id: AGENT_B, name: 'Bia' }]}
        onChange={(next) => {
          setAnswers(next);
          onAnswers(next);
        }}
      />
    );
  }

  it('fora do Bitrix24: ids dos usuários, número do canal e agente da lista', () => {
    let last: FunctionAnswers = {};
    render(<ExtraHarness onAnswers={(answers) => (last = answers)} />);
    type(/^Vendedores/, '3, 5');
    expect(last['teste.vendedores']).toEqual([3, 5]);
    fireEvent.change(screen.getByRole('spinbutton', { name: /^Canal aberto/ }), {
      target: { value: '7' },
    });
    expect(last['teste.canal_aberto']).toBe(7);
    fireEvent.change(screen.getByRole('combobox', { name: /^Agente de vendas/ }), {
      target: { value: AGENT_B },
    });
    expect(last['teste.agente']).toBe(AGENT_B);
  });

  it('lista de usuários respondida conta como respondida', () => {
    expect(isAnswered(extra.fields[0]!, { 'teste.vendedores': [3] })).toBe(true);
    expect(isAnswered(extra.fields[0]!, { 'teste.vendedores': [] })).toBe(false);
  });
});
