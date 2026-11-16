import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LandingTabs, type LandingTab } from './landing-tabs';

function makeTab(id: string, label: string): LandingTab {
  return {
    id,
    label,
    title: `Título ${label}`,
    steps: [1, 2, 3].map((n) => ({ text: `${label} texto ${n}`, counter: `Passo ${n} de 3` })),
  };
}

const TABS = [makeTab('a', 'Ativar'), makeTab('b', 'Criar')];

function setup() {
  render(<LandingTabs tabs={TABS} backLabel="Voltar" nextLabel="Próximo" />);
}

const back = () => screen.getByRole('button', { name: 'Voltar' }) as HTMLButtonElement;
const next = () => screen.getByRole('button', { name: 'Próximo' }) as HTMLButtonElement;

afterEach(cleanup);

describe('LandingTabs', () => {
  it('abre na primeira aba, no primeiro passo', () => {
    setup();
    expect(screen.getByText('Título Ativar')).toBeTruthy();
    expect(screen.getByText('Ativar texto 1')).toBeTruthy();
    expect(screen.getByText('Passo 1 de 3')).toBeTruthy();
  });

  it('avança com Próximo e volta com Voltar', () => {
    setup();
    fireEvent.click(next());
    expect(screen.getByText('Ativar texto 2')).toBeTruthy();
    expect(screen.getByText('Passo 2 de 3')).toBeTruthy();
    fireEvent.click(back());
    expect(screen.getByText('Ativar texto 1')).toBeTruthy();
  });

  it('desabilita Voltar no primeiro passo e Próximo no último', () => {
    setup();
    expect(back().disabled).toBe(true);
    expect(next().disabled).toBe(false);
    fireEvent.click(next());
    fireEvent.click(next());
    expect(screen.getByText('Passo 3 de 3')).toBeTruthy();
    expect(next().disabled).toBe(true);
    expect(back().disabled).toBe(false);
  });

  it('ao trocar de aba volta ao primeiro passo', () => {
    setup();
    fireEvent.click(next());
    fireEvent.click(next());
    fireEvent.click(screen.getByRole('tab', { name: 'Criar' }));
    expect(screen.getByText('Título Criar')).toBeTruthy();
    expect(screen.getByText('Criar texto 1')).toBeTruthy();
    expect(screen.getByText('Passo 1 de 3')).toBeTruthy();
  });

  it('só a aba ativa entra na ordem do Tab (tabindex móvel)', () => {
    setup();
    expect(screen.getByRole('tab', { name: 'Ativar' }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: 'Criar' }).getAttribute('tabindex')).toBe('-1');
  });

  it('setas, Home e End trocam de aba, dão foco a ela e voltam ao primeiro passo', () => {
    setup();
    fireEvent.click(next());
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Ativar' }), { key: 'ArrowRight' });
    const criar = screen.getByRole('tab', { name: 'Criar' });
    expect(criar.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(criar);
    expect(screen.getByText('Passo 1 de 3')).toBeTruthy();

    // ArrowRight na última aba dá a volta para a primeira.
    fireEvent.keyDown(criar, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Ativar' }).getAttribute('aria-selected')).toBe('true');
    // ArrowLeft na primeira dá a volta para a última.
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Ativar' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Criar' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Criar' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Ativar' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Ativar' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Criar' }).getAttribute('aria-selected')).toBe('true');
  });

  it('anuncia a troca de passo e liga a aba ao painel', () => {
    setup();
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-live')).toBe('polite');
    const tab = screen.getByRole('tab', { name: 'Ativar' });
    expect(tab.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(tab.id);
  });

  it('marca a aba ativa com aria-selected', () => {
    setup();
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Ativar' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Criar' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tabpanel')).toBeTruthy();
  });
});
