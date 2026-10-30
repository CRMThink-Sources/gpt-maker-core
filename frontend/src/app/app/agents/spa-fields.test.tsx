import type { BitrixSpaValue, FunctionSpaValue } from '@gptmaker/contracts';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpaFields } from './bitrix-pickers';

// Listas do portal como o BX24 devolveria (SPA 1204, docs/bitrix-observado.md).
vi.mock('@/lib/crm-fields', async (original) => ({
  ...(await original<typeof import('@/lib/crm-fields')>()),
  useSpaTypes: () => ({
    data: [
      { entityTypeId: 1204, title: 'SPA Vitor' },
      { entityTypeId: 1128, title: 'SPA Amanda' },
    ],
    failed: false,
  }),
  useSpaCategories: (id: number | null) => ({
    data: id ? [{ id: 180, name: 'Suporte' }] : null,
    failed: false,
  }),
  useSpaStages: (id: number | null) => ({
    data: id ? [{ id: 'DT1204_180:NEW', name: 'Iniciar', semantics: null }] : null,
    failed: false,
  }),
  useSpaFields: (id: number | null) => ({
    data: id
      ? [
          { code: 'ufCrm136_1', label: 'Descrição', type: 'string' },
          {
            code: 'ufCrm136_2',
            label: 'Prioridade',
            type: 'enumeration',
            options: [
              { id: '101', label: 'Low' },
              { id: '103', label: 'HIGH' },
            ],
          },
        ]
      : null,
    failed: false,
  }),
}));

const values: FunctionSpaValue[] = [
  { id: 'problema', label: 'Problema relatado', required: true },
  { id: 'prioridade', label: 'Prioridade', required: true, options: ['LOW', 'HIGH', 'URGENT'] },
];

let last: BitrixSpaValue | undefined;
function Harness({ initial }: { initial?: BitrixSpaValue }) {
  const [value, setValue] = useState<BitrixSpaValue | undefined>(initial);
  return (
    <SpaFields
      values={values}
      value={value}
      onChange={(next) => {
        last = next;
        setValue(next);
      }}
      issueOf={(id) => (id === 'problema' && !value?.fields.problema ? 'obrigatório' : undefined)}
    />
  );
}

afterEach(cleanup);

/** Digita no campo do SPA e clica na opção. */
function pickSpa(search: string, title: string) {
  const input = screen.getByLabelText('Processo inteligente');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: search } });
  fireEvent.mouseDown(
    within(screen.getByRole('listbox')).getByRole('option', { name: new RegExp(title) }),
  );
}

describe('seletor de SPA do formulário', () => {
  it('escolhe o SPA, a etapa e os campos; sugere os itens da lista pelo nome', () => {
    render(<Harness />);
    pickSpa('vitor', 'SPA Vitor');
    expect(screen.getByText('obrigatório')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Etapa inicial'), {
      target: { value: 'DT1204_180:NEW' },
    });
    fireEvent.change(screen.getByLabelText('Problema relatado'), {
      target: { value: 'ufCrm136_1' },
    });
    fireEvent.change(screen.getByLabelText('Prioridade'), { target: { value: 'ufCrm136_2' } });
    expect(last).toEqual({
      entityTypeId: 1204,
      categoryId: 180,
      stageId: 'DT1204_180:NEW',
      fields: { problema: 'ufCrm136_1', prioridade: 'ufCrm136_2' },
      lists: { prioridade: { LOW: 101, HIGH: 103 } },
    });
    // URGENT não tem item de mesmo nome: o cliente liga à mão.
    fireEvent.change(screen.getByLabelText('Prioridade: URGENT'), { target: { value: '103' } });
    expect(last?.lists?.prioridade).toEqual({ LOW: 101, HIGH: 103, URGENT: 103 });
  });

  it('trocar o SPA limpa funil, etapa, campos e ligações', () => {
    render(
      <Harness
        initial={{
          entityTypeId: 1204,
          categoryId: 180,
          stageId: 'DT1204_180:NEW',
          fields: { prioridade: 'ufCrm136_2' },
          lists: { prioridade: { LOW: 101 } },
        }}
      />,
    );
    pickSpa('1128', 'SPA Amanda');
    expect(last).toEqual({ entityTypeId: 1128, fields: {} });
  });

  it('busca pelo nome sem acento nem maiúsculas e escolhe pelo teclado', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Processo inteligente');
    fireEvent.focus(input);
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(2);
    fireEvent.change(input, { target: { value: 'AMÁNDA' } });
    expect(
      within(screen.getByRole('listbox'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['SPA Amanda1128']);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(last?.entityTypeId).toBe(1128);
    expect((input as HTMLInputElement).value).toBe('SPA Amanda');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'nada disso' } });
    expect(screen.getByText('Nenhum resultado')).toBeTruthy();
  });
});
