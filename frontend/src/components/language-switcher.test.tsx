import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageSwitcher } from '@/components/language-switcher';
import { I18nProvider } from '@/i18n';
import { LOCALE_STORAGE_KEY } from '@/i18n/config';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('LanguageSwitcher', () => {
  it('troca o idioma, avisa quem chamou e guarda a preferência', () => {
    const onChange = vi.fn();
    render(
      <I18nProvider>
        <LanguageSwitcher onChange={onChange} />
      </I18nProvider>,
    );
    expect(screen.getByText('Idioma')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } });
    expect(screen.getByText('Language')).toBeTruthy();
    expect(onChange).toHaveBeenCalledWith('en');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('oferece os três idiomas', () => {
    render(<LanguageSwitcher />);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Português',
      'English',
      'Español',
    ]);
  });
});
