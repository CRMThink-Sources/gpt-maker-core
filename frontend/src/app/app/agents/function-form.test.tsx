import {
  compileAgent,
  type FunctionAnswers,
  functionTemplateContentSchema,
  validateFunctionAnswers,
} from '@gptmaker/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { BehaviorMeter, FunctionForm } from './function-form';

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
