import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n';
import { AppShell } from './app-shell';

const SUPPORT_URL = 'https://www.bitrix24.net/oauth/select/?preset=im&IM_DIALOG=networkLinesabc';

let isAdmin = false;
let supportUrl: string | null = SUPPORT_URL;
let crmTools = false;
let pathname = '/app';

vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('./session-provider', () => ({
  useAppSession: () => ({
    session: {
      user: { id: '1', name: 'Maria', isAdmin },
      tenant: { code: 'acme', status: 'ACTIVE', locale: 'pt-BR' },
      canManage: false,
      features: { crmTools },
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
  crmTools = false;
  pathname = '/app';
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
    // o grupo Suporte continua, pois a Ajuda não depende do canal
    expect(screen.getByRole('link', { name: 'Ajuda' })).toBeTruthy();
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

/** Títulos dos grupos, na ordem em que aparecem no menu. */
function groupTitles() {
  return screen.getAllByText(/^(Configurações|Avançado|Suporte)$/).map((el) => el.textContent);
}

describe('grupos do menu (spec app-navigation)', () => {
  it('administrador com CRM: CRM e Chave Vibecode ficam em Avançado, na ordem dos grupos', () => {
    isAdmin = true;
    crmTools = true;
    renderShell();
    expect(groupTitles()).toEqual(['Configurações', 'Avançado', 'Suporte']);
    const advanced = screen.getByText('Avançado').parentElement!;
    expect(within(advanced).getByRole('link', { name: 'CRM para o agente' })).toBeTruthy();
    expect(within(advanced).getByRole('link', { name: 'Chave Vibecode' })).toBeTruthy();
    const settings = screen.getByText('Configurações').parentElement!;
    expect(within(settings).queryByRole('link', { name: 'Chave Vibecode' })).toBeNull();
    expect(within(settings).getByRole('link', { name: 'Permissões' })).toBeTruthy();
  });

  it('não administrador com CRM: Avançado mostra só o CRM', () => {
    crmTools = true;
    renderShell();
    const advanced = screen.getByText('Avançado').parentElement!;
    expect(within(advanced).getByRole('link', { name: 'CRM para o agente' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Chave Vibecode' })).toBeNull();
  });

  it('sem CRM e sem ser administrador, o grupo Avançado não aparece', () => {
    renderShell();
    expect(screen.queryByText('Avançado')).toBeNull();
    expect(screen.queryByRole('link', { name: 'CRM para o agente' })).toBeNull();
  });

  it('a Chave Vibecode fica marcada como página atual em /app/ai-key', () => {
    isAdmin = true;
    pathname = '/app/ai-key';
    renderShell();
    expect(screen.getByRole('link', { name: 'Chave Vibecode' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });
});

describe('item Ajuda no menu (spec app-help)', () => {
  it.each([false, true])('aparece para todos os papéis, antes do suporte (admin: %s)', (admin) => {
    isAdmin = admin;
    renderShell();
    const help = screen.getByRole('link', { name: 'Ajuda' });
    expect(help.getAttribute('href')).toBe('/app/help');
    const support = screen.getByRole('link', { name: 'Falar com o suporte' });
    expect(help.compareDocumentPosition(support) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('em /app/help o item fica marcado como página atual', () => {
    pathname = '/app/help';
    renderShell();
    expect(screen.getByRole('link', { name: 'Ajuda' }).getAttribute('aria-current')).toBe('page');
  });

  it('no celular, acionar a Ajuda fecha a gaveta', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menu' }));
    const links = screen.getAllByRole('link', { name: 'Ajuda' });
    expect(links).toHaveLength(2);
    fireEvent.click(links[1]!);
    expect(screen.getAllByRole('link', { name: 'Ajuda' })).toHaveLength(1);
  });
});
