'use client';

import {
  flattenFields,
  FUNCTION_TRANSLATION_LOCALES,
  type FunctionField,
  type FunctionTranslationLocale,
  type FunctionTranslations,
  type TranslatableText,
  translatableTexts,
  translationCompleteness,
  translationOf,
  withTranslation,
} from '@gptmaker/contracts';
import { useMemo, useState } from 'react';
import { inputClass } from '../../../app/agents/agent-fields';
import { Segmented } from './kit';

const LOCALE_LABELS: Record<FunctionTranslationLocale, string> = {
  en: 'English',
  es: 'Español',
};

const PART_LABELS: Record<string, string> = {
  label: 'Rótulo',
  help: 'Ajuda',
  placeholder: 'Exemplo no campo',
  options: 'Opção',
  subfields: 'Subcampo',
  spaValues: 'Valor do processo',
  assistQuestions: 'Pergunta da ajuda da IA',
};

/** O que o texto é, em palavras: `Rótulo`, `Opção`, `Pergunta da ajuda da IA 2`... */
function partLabel(item: TranslatableText): string {
  const [, , part, key, sub] = item.keys;
  if (item.keys[0] === 'name') return 'Nome da função';
  if (item.keys[0] === 'description') return 'Descrição da função';
  if (part === 'assistQuestions') return `${PART_LABELS[part]} ${Number(key) + 1}`;
  if (part === 'spaValues') return `${PART_LABELS[part]} (${sub === 'help' ? 'ajuda' : 'rótulo'})`;
  return PART_LABELS[String(part)] ?? String(part);
}

/**
 * Traduções en/es do formulário (spec function-template-i18n): o texto em português ao lado do
 * campo a traduzir. Texto sem tradução cai em português para o cliente; não bloqueia salvar nem
 * publicar. Serve ao editor de função e ao de bloco.
 */
export function TranslationsEditor({
  fields,
  translations,
  meta,
  onChange,
  disabled,
  note,
}: {
  /** Campos que este editor é dono (os dos blocos são traduzidos no bloco). */
  fields: FunctionField[];
  translations: FunctionTranslations | undefined;
  /** Nome e descrição da função (não existe no bloco). */
  meta?: { name: string; description: string };
  onChange: (translations: FunctionTranslations | undefined) => void;
  disabled?: boolean;
  note?: string;
}) {
  const [locale, setLocale] = useState<FunctionTranslationLocale>('en');
  const [onlyMissing, setOnlyMissing] = useState(false);

  const texts = useMemo(() => translatableTexts({ fields }, meta), [fields, meta]);
  const labels = useMemo(
    () => new Map(flattenFields(fields).map((field) => [field.id, field.label])),
    [fields],
  );
  const completeness = translationCompleteness({ fields, translations }, meta);
  const current = completeness.find((item) => item.locale === locale)!;
  const entry = translations?.[locale];

  const edit = (item: TranslatableText, value: string) => {
    const next = withTranslation(entry, item, value);
    const merged: FunctionTranslations = { ...translations };
    if (next) merged[locale] = next;
    else delete merged[locale];
    onChange(Object.keys(merged).length > 0 ? merged : undefined);
  };

  // Agrupa por campo (a ordem do formulário) e deixa nome e descrição no começo.
  const groups = useMemo(() => {
    const result: Array<{ key: string; title: string; items: TranslatableText[] }> = [];
    for (const item of texts) {
      const fieldId = item.keys[0] === 'fields' ? String(item.keys[1]) : '';
      const last = result.at(-1);
      if (last && last.key === fieldId) last.items.push(item);
      else
        result.push({
          key: fieldId,
          title: fieldId ? (labels.get(fieldId) ?? fieldId) : 'Função',
          items: [item],
        });
    }
    return result;
  }, [texts, labels]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Idioma da tradução"
          value={locale}
          options={FUNCTION_TRANSLATION_LOCALES.map((value) => ({
            value,
            label: LOCALE_LABELS[value],
          }))}
          onChange={setLocale}
        />
        <div className="flex items-center gap-4 text-sm">
          <span
            className={current.missing.length === 0 ? 'text-emerald-700' : 'text-amber-700'}
            role="status"
          >
            {current.translated} de {current.total} traduzidos
            {current.missing.length > 0 && ` · faltam ${current.missing.length}`}
          </span>
          <label className="flex items-center gap-1.5 text-zinc-600">
            <input
              type="checkbox"
              checked={onlyMissing}
              onChange={(e) => setOnlyMissing(e.target.checked)}
            />
            Só o que falta
          </label>
        </div>
      </div>
      <p className="text-xs text-zinc-500">
        Texto sem tradução aparece em português para o cliente. O texto que vai para o agente no
        GPTMaker não é traduzido.
        {note ? ` ${note}` : ''}
      </p>

      {groups.map((group) => {
        const items = onlyMissing
          ? group.items.filter((item) => !translationOf(entry, item)?.trim())
          : group.items;
        if (items.length === 0) return null;
        return (
          <section
            key={group.key || 'function'}
            className="rounded-xl border border-zinc-200 bg-white p-4"
            aria-label={group.title}
          >
            <h4 className="mb-3 text-sm font-semibold text-zinc-900">{group.title}</h4>
            <div className="space-y-3">
              {items.map((item) => {
                const value = translationOf(entry, item) ?? '';
                const long = item.text.length > 80;
                const name = `${partLabel(item)} (${LOCALE_LABELS[locale]}): ${group.title}`;
                return (
                  <div key={item.path} className="grid gap-2 sm:grid-cols-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-zinc-500">{partLabel(item)}</p>
                      <p className="mt-0.5 text-sm text-zinc-700">{item.text}</p>
                    </div>
                    {long ? (
                      <textarea
                        className={`${inputClass} min-h-20`}
                        aria-label={name}
                        value={value}
                        disabled={disabled}
                        onChange={(e) => edit(item, e.target.value)}
                      />
                    ) : (
                      <input
                        className={inputClass}
                        aria-label={name}
                        value={value}
                        disabled={disabled}
                        onChange={(e) => edit(item, e.target.value)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
