'use client';

import { LOCALES, isLocale } from '@gptmaker/contracts';
import { LOCALE_LABELS } from '@/i18n/config';
import { useLocale, useT } from '@/i18n';

/** Seletor do idioma da interface (spec app-i18n, "Troca manual de idioma"). */
export function LanguageSwitcher({
  onChange,
}: {
  onChange?: (locale: (typeof LOCALES)[number]) => void;
}) {
  const t = useT('common');
  const { locale, setLocale } = useLocale();
  return (
    <label className="flex items-center gap-2 text-xs text-zinc-500">
      <span>{t('language')}</span>
      <select
        value={locale}
        onChange={(event) => {
          const next = event.target.value;
          if (!isLocale(next)) return;
          setLocale(next);
          onChange?.(next);
        }}
        className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700"
      >
        {LOCALES.map((value) => (
          <option key={value} value={value}>
            {LOCALE_LABELS[value]}
          </option>
        ))}
      </select>
    </label>
  );
}
