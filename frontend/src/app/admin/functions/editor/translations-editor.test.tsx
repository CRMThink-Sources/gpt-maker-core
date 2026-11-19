import type { FunctionField, FunctionTranslations } from '@gptmaker/contracts';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationsEditor } from './translations-editor';

afterEach(cleanup);

const FIELDS: FunctionField[] = [
  {
    kind: 'TEXT',
    id: 'empresa.nome',
    label: 'Nome da empresa',
    help: 'Como os clientes conhecem',
    required: true,
    maxLength: 100,
    multiline: false,
  },
  {
    kind: 'CHOICE',
    id: 'comum.tom',
    label: 'Tom do atendimento',
    required: true,
    options: [
      { value: 'formal', label: 'Formal', snippet: 'Use linguagem formal.' },
      { value: 'normal', label: 'Cordial', snippet: 'Use linguagem cordial.' },
    ],
  },
];
const META = { name: 'SDR', description: 'Qualifica leads' };

/** Editor controlado, como as páginas o usam; `changes` registra cada alteração. */
function Harness({
  initial,
  meta = META,
  changes = vi.fn(),
}: {
  initial?: FunctionTranslations;
  meta?: typeof META;
  changes?: (value: FunctionTranslations | undefined) => void;
}) {
  const [translations, setTranslations] = useState(initial);
  return (
    <TranslationsEditor
      fields={FIELDS}
      translations={translations}
      meta={meta}
      onChange={(value) => {
        changes(value);
        setTranslations(value);
      }}
    />
  );
}

const status = () => screen.getByRole('status').textContent;

describe('aba Traduções do backoffice', () => {
  it('mostra o português ao lado do campo e conta o que falta no idioma', () => {
    render(<Harness />);
    // nome, descrição, rótulo+ajuda do campo de texto, rótulo da escolha e duas opções
    expect(status()).toBe('0 de 7 traduzidos · faltam 7');
    expect(screen.getByText('Como os clientes conhecem')).toBeTruthy();
    expect(
      screen.getByRole('textbox', { name: /Rótulo \(English\): Nome da empresa/ }),
    ).toBeTruthy();
  });

  it('editar um texto grava a tradução e atualiza a contagem', () => {
    const changes = vi.fn();
    render(<Harness changes={changes} />);
    fireEvent.change(screen.getByRole('textbox', { name: /Rótulo \(English\): Nome da empresa/ }), {
      target: { value: 'Company name' },
    });
    expect(changes).toHaveBeenLastCalledWith({
      en: { fields: { 'empresa.nome': { label: 'Company name' } } },
    });
    expect(status()).toBe('1 de 7 traduzidos · faltam 6');
  });

  it('cada idioma tem a sua contagem e as suas traduções', () => {
    render(
      <Harness
        initial={{
          en: { name: 'Sales' },
          es: { name: 'Ventas', description: 'Califica leads' },
        }}
      />,
    );
    expect(status()).toBe('1 de 7 traduzidos · faltam 6');
    fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
    expect(status()).toBe('2 de 7 traduzidos · faltam 5');
    expect(
      (screen.getByRole('textbox', { name: /Nome da função \(Español\)/ }) as HTMLInputElement)
        .value,
    ).toBe('Ventas');
  });

  it('"só o que falta" esconde o que já foi traduzido', () => {
    render(<Harness initial={{ en: { name: 'Sales', description: 'Qualifies leads' } }} />);
    expect(screen.queryByRole('textbox', { name: /Nome da função/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Só o que falta' }));
    expect(screen.queryByRole('textbox', { name: /Nome da função/ })).toBeNull();
    expect(
      screen.getByRole('textbox', { name: /Rótulo \(English\): Nome da empresa/ }),
    ).toBeTruthy();
  });

  it('apagar a última tradução remove o idioma do conteúdo', () => {
    const changes = vi.fn();
    render(<Harness initial={{ en: { name: 'Sales' } }} changes={changes} />);
    fireEvent.change(screen.getByRole('textbox', { name: /Nome da função \(English\)/ }), {
      target: { value: '' },
    });
    expect(changes).toHaveBeenLastCalledWith(undefined);
    expect(status()).toBe('0 de 7 traduzidos · faltam 7');
  });

  it('opções da escolha ficam sob o campo a que pertencem', () => {
    render(<Harness />);
    const group = screen.getByRole('region', { name: 'Tom do atendimento' });
    expect(within(group).getAllByRole('textbox')).toHaveLength(3);
    expect(within(group).getByText('Cordial')).toBeTruthy();
  });

  it('sem nome e descrição (bloco), conta só os campos', () => {
    render(
      <TranslationsEditor fields={FIELDS} translations={undefined} onChange={() => undefined} />,
    );
    expect(status()).toBe('0 de 5 traduzidos · faltam 5');
  });

  it('desabilitado, não deixa editar', () => {
    render(
      <TranslationsEditor
        fields={FIELDS}
        translations={undefined}
        meta={META}
        disabled
        onChange={() => undefined}
      />,
    );
    for (const box of screen.getAllByRole('textbox')) {
      expect((box as HTMLInputElement).disabled).toBe(true);
    }
  });
});
