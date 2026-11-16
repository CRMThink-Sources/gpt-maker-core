import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageSwitcher } from './language-switcher';

afterEach(cleanup);

describe('LanguageSwitcher', () => {
  it('lista as três versões com os endereços corretos', () => {
    render(<LanguageSwitcher current="en" label="Idioma" />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/lp/gptthink', '/lp/gptthink/en', '/lp/gptthink/es']);
  });

  it('marca só o idioma atual com aria-current', () => {
    render(<LanguageSwitcher current="en" label="Idioma" />);
    expect(screen.getByRole('link', { name: 'English' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Português' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: 'Español' }).getAttribute('aria-current')).toBeNull();
  });

  it('mostra a sigla de cada idioma e nomeia o link por extenso', () => {
    render(<LanguageSwitcher current="pt-BR" label="Idioma" />);
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['PT', 'EN', 'ES']);
    expect(screen.getByRole('link', { name: 'Español' }).textContent).toBe('ES');
  });

  it('nomeia a navegação com o rótulo recebido', () => {
    render(<LanguageSwitcher current="pt-BR" label="Idioma" />);
    expect(screen.getByRole('navigation', { name: 'Idioma' })).toBeTruthy();
  });
});
