import {
  type FunctionAnswers,
  functionTemplateContentSchema,
  validateFunctionAnswers,
} from '@gptmaker/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { FunctionForm } from './function-form';

const form = functionTemplateContentSchema.parse({
  agentType: 'SUPPORT',
  profile: { jobName: 'Ana' },
  fields: [
    {
      kind: 'KNOWLEDGE',
      id: 'base.produtos',
      label: 'Produtos',
      required: false,
      maxItems: 20,
      subfields: [{ id: 'nome', label: 'Nome', required: true, maxLength: 60, multiline: false }],
      format: 'Produto: {{nome}}',
    },
  ],
  behavior: 'Você é {{agente.nome}}.',
});

const items = (count: number, empty: number[] = []) =>
  Array.from({ length: count }, (_, i) => ({
    itemKey: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    values: { nome: empty.includes(i) ? '' : `Produto ${i + 1}` },
  }));

function Harness({ initial }: { initial: FunctionAnswers }) {
  const [answers, setAnswers] = useState<FunctionAnswers>(initial);
  const { issues } = validateFunctionAnswers(form, answers);
  return <FunctionForm form={form} answers={answers} onChange={setAnswers} issues={issues} />;
}

const toggles = () => screen.getAllByRole('button', { name: /(Expandir|Recolher) item/ });
const openCount = () => toggles().filter((b) => b.getAttribute('aria-expanded') === 'true').length;

afterEach(cleanup);

describe('base de conhecimento recolhível', () => {
  it('com até 3 itens todos ficam abertos e sem controles de recolher', () => {
    render(<Harness initial={{ 'base.produtos': items(3) }} />);
    expect(screen.queryByText('Expandir todos')).toBeNull();
    expect(openCount()).toBe(3);
  });

  it('com mais de 3 itens começam recolhidos e alternam individualmente', () => {
    render(<Harness initial={{ 'base.produtos': items(5) }} />);
    expect(openCount()).toBe(0);
    expect(screen.getByText('Produto 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Expandir item 2' }));
    expect(openCount()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Recolher item 2' }));
    expect(openCount()).toBe(0);
  });

  it('Expandir todos e Recolher todos mudam todos os cartões', () => {
    render(<Harness initial={{ 'base.produtos': items(5) }} />);
    fireEvent.click(screen.getByText('Expandir todos'));
    expect(openCount()).toBe(5);
    fireEvent.click(screen.getByText('Recolher todos'));
    expect(openCount()).toBe(0);
  });

  it('item com erro de validação abre sozinho, e o contador segue visível recolhido', () => {
    render(<Harness initial={{ 'base.produtos': items(5, [3]) }} />);
    expect(openCount()).toBe(1);
    expect(
      screen.getByRole('button', { name: 'Recolher item 4' }).getAttribute('aria-expanded'),
    ).toBe('true');
    expect(screen.getAllByText(/\/\d+$/).length).toBeGreaterThanOrEqual(5);
  });

  it('item novo abre expandido', () => {
    render(<Harness initial={{ 'base.produtos': items(5) }} />);
    fireEvent.click(screen.getByText(/Adicionar item/));
    expect(
      screen.getByRole('button', { name: 'Recolher item 6' }).getAttribute('aria-expanded'),
    ).toBe('true');
  });
});
