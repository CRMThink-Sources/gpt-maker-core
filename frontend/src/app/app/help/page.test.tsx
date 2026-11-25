import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n';
import HelpPage from './page';

const SUPPORT_URL = 'https://www.bitrix24.net/oauth/select/?preset=im&IM_DIALOG=networkLinesabc';

let supportUrl: string | null = SUPPORT_URL;

vi.mock('../session-provider', () => ({
  useAppSession: () => ({ config: { supportUrl, apiBaseUrl: 'https://api.exemplo.com' } }),
}));

function renderPage() {
  return render(
    <I18nProvider>
      <HelpPage />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  supportUrl = SUPPORT_URL;
});

describe('página Ajuda (spec app-help)', () => {
  it('mostra o guia de primeiros passos e os temas das perguntas', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Ajuda' })).toBeTruthy();
    expect(screen.getByText('Crie o agente')).toBeTruthy();
    expect(screen.getByText('Criar e treinar o agente')).toBeTruthy();
    expect(screen.getByText('Créditos e plano')).toBeTruthy();
    expect(screen.getByText('Atendimento e transferência para humano')).toBeTruthy();
  });

  it('as perguntas começam recolhidas (resposta dentro de <details> fechado)', () => {
    renderPage();
    const faq = screen.getByRole('region', { name: 'Perguntas frequentes' });
    const items = Array.from(faq.querySelectorAll('details'));
    expect(items).toHaveLength(9);
    expect(items.every((item) => !item.open)).toBe(true);
    // cada pergunta é o <summary> do seu <details>, com a resposta junto
    const first = screen.getByText('Como criar um agente?');
    expect(first.tagName).toBe('SUMMARY');
    expect(first.parentElement?.textContent).toContain('Abra Agentes');
  });

  it('oferece o download da skill em nova aba, sem repassar a origem', () => {
    renderPage();
    const card = screen.getByRole('region', { name: 'Tire dúvidas no seu Claude' });
    const link = within(card).getByRole('link', { name: 'Baixar skill' });
    expect(link.getAttribute('href')).toBe('https://api.exemplo.com/public/help-skill/download');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('explica como instalar e como liberar o acesso, com o domínio da API', () => {
    renderPage();
    const card = screen.getByRole('region', { name: 'Tire dúvidas no seu Claude' });
    expect(within(card).getByText('Como instalar').tagName).toBe('SUMMARY');
    expect(within(card).getByText('Como receber o conteúdo atualizado').tagName).toBe('SUMMARY');
    expect(card.textContent).toContain('api.exemplo.com');
  });

  it('com o canal configurado, o botão abre o suporte em nova aba sem repassar a origem', () => {
    renderPage();
    const link = screen.getByRole('link', { name: 'Falar com o suporte' });
    expect(link.getAttribute('href')).toBe(SUPPORT_URL);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it.each([null, ''])('sem canal (%j), o botão some e o resto da página fica', (value) => {
    supportUrl = value;
    renderPage();
    expect(screen.queryByRole('link', { name: 'Falar com o suporte' })).toBeNull();
    expect(screen.getByText('Primeiros passos')).toBeTruthy();
    expect(screen.getByText('Como criar um agente?')).toBeTruthy();
  });

  it('em inglês, os textos seguem o idioma da interface', () => {
    window.localStorage.setItem('gptthink.locale', 'en');
    renderPage();
    expect(screen.getByText('Getting started')).toBeTruthy();
    expect(screen.getByText('How do I create an agent?')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Contact support' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download skill' })).toBeTruthy();
    expect(screen.getByText(/allow network access to the domain api\.exemplo\.com/)).toBeTruthy();
  });
});
