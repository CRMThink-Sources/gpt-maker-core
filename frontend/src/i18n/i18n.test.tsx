import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, useErrorMessage, useFormat, useLocale, useT } from '@/i18n';
import { LOCALE_STORAGE_KEY, MESSAGES } from '@/i18n/config';

function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object'
      ? keys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe('dicionários', () => {
  it('en e es têm exatamente as chaves de pt-BR', () => {
    const base = keys(MESSAGES['pt-BR']).sort();
    expect(keys(MESSAGES.en).sort()).toEqual(base);
    expect(keys(MESSAGES.es).sort()).toEqual(base);
  });
});

function Probe() {
  const t = useT('common');
  const { locale, setLocale } = useLocale();
  const format = useFormat();
  return (
    <div>
      <span data-testid="texto">{t('save')}</span>
      <span data-testid="locale">{locale}</span>
      <span data-testid="numero">{format.number(1234.5)}</span>
      <button onClick={() => setLocale('en')}>trocar</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.lang = '';
});

describe('I18nProvider', () => {
  it('sem provider usa pt-BR', () => {
    render(<Probe />);
    expect(screen.getByTestId('texto').textContent).toBe('Salvar');
  });

  it('usa a preferência salva', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(await screen.findByText('Guardar')).toBeTruthy();
    expect(document.documentElement.lang).toBe('es');
  });

  it('troca o idioma, formata no novo idioma e guarda a escolha', async () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('numero').textContent).toBe('1.234,5');
    await act(async () => screen.getByText('trocar').click());
    expect(screen.getByTestId('texto').textContent).toBe('Save');
    expect(screen.getByTestId('numero').textContent).toBe('1,234.5');
    expect(document.documentElement.lang).toBe('en');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });
});

describe('useErrorMessage', () => {
  function Err({ error, locale }: { error: unknown; locale: 'en' | 'pt-BR' }) {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    return <ErrText error={error} />;
  }
  function ErrText({ error }: { error: unknown }) {
    const message = useErrorMessage();
    return <span data-testid="erro">{message(error)}</span>;
  }

  it('traduz pelo código', async () => {
    render(
      <I18nProvider>
        <Err locale="en" error={{ code: 'AGENT_CREATION_IN_PROGRESS', message: 'x' }} />
      </I18nProvider>,
    );
    expect((await screen.findByTestId('erro')).textContent).toBe(
      'Another agent is being created; wait and try again',
    );
  });

  it('código sem tradução mostra o message original', () => {
    render(<ErrText error={Object.assign(new Error('mensagem do servidor'), { code: 'OUTRO' })} />);
    expect(screen.getByTestId('erro').textContent).toBe('mensagem do servidor');
  });

  it('resposta sem envelope usa a mensagem genérica', () => {
    render(<ErrText error={Object.assign(new Error('x'), { code: 'HTTP_502' })} />);
    expect(screen.getByTestId('erro').textContent).toContain('Não foi possível concluir');
  });
});

describe('idioma do portal Bitrix', () => {
  it.each([
    ['br', 'pt-BR'],
    ['la', 'es'],
    ['en', 'en'],
    ['de', 'en'],
  ])('portal %s sem preferência salva usa %s', async (lang, esperado) => {
    const bx24 = await import('@/lib/bx24');
    const spy = vi.spyOn(bx24, 'loadBx24').mockResolvedValue({ getLang: () => lang } as never);
    const parent = vi.spyOn(window, 'parent', 'get').mockReturnValue({} as never);
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('locale').textContent).toBe(esperado));
    spy.mockRestore();
    parent.mockRestore();
  });

  it('a preferência salva vence o idioma do portal', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es');
    const bx24 = await import('@/lib/bx24');
    const spy = vi.spyOn(bx24, 'loadBx24').mockResolvedValue({ getLang: () => 'br' } as never);
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('locale').textContent).toBe('es'));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
