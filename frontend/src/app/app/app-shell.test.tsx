import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n';
import { AppShell } from './app-shell';

const SUPPORT_URL = 'https://www.bitrix24.net/oauth/select/?preset=im&IM_DIALOG=networkLinesabc';

let isAdmin = false;
let supportUrl: string | null = SUPPORT_URL;

vi.mock('next/navigation', () => ({ usePathname: () => '/app' }));
vi.mock('./session-provider', () => ({
  useAppSession: () => ({
    session: {
      user: { id: '1', name: 'Maria', isAdmin },
      tenant: { code: 'acme', status: 'ACTIVE', locale: 'pt-BR' },
      canManage: false,
    },
    api: vi.fn(),
    config: { supportUrl },
  }),
}));

function renderShell() {
  return render(
    <I18nProvider>
      <AppShell>conteúdo</AppShell>
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  isAdmin = false;
  supportUrl = SUPPORT_URL;
});

describe('item Suporte no menu (spec support-channel)', () => {
  it('com o canal configurado, abre o link em nova aba sem repassar a origem', () => {
    renderShell();
    const link = screen.getByRole('link', { name: 'Falar com o suporte' });
    expect(link.getAttribute('href')).toBe(SUPPORT_URL);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('aria-current')).toBeNull();
  });

  it.each([false, true])('aparece para todos os papéis (admin: %s)', (admin) => {
    isAdmin = admin;
    renderShell();
    expect(screen.getByRole('link', { name: 'Falar com o suporte' })).toBeTruthy();
  });

  it.each([null, ''])('sem canal configurado (%j), o item não aparece', (value) => {
    supportUrl = value;
    renderShell();
    expect(screen.queryByRole('link', { name: 'Falar com o suporte' })).toBeNull();
    expect(screen.queryByText('Suporte')).toBeNull();
    // o resto do menu segue normal
    expect(screen.getByRole('link', { name: 'Agentes' })).toBeTruthy();
  });

  it('no celular, acionar o item fecha a gaveta', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menu' }));
    // aside fixo + gaveta
    const links = screen.getAllByRole('link', { name: 'Falar com o suporte' });
    expect(links).toHaveLength(2);
    fireEvent.click(links[1]!);
    expect(screen.getAllByRole('link', { name: 'Falar com o suporte' })).toHaveLength(1);
  });

  it('em espanhol, o texto segue o idioma da interface', () => {
    window.localStorage.setItem('gptthink.locale', 'es');
    renderShell();
    expect(screen.getByRole('link', { name: 'Hablar con soporte' })).toBeTruthy();
  });
});
