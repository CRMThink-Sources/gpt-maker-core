'use client';

import {
  normalizeTrainingTags,
  TRAINING_TAG_MAX_LENGTH,
  TRAINING_TAGS_MAX,
} from '@gptmaker/contracts';
import { useId, useState, type KeyboardEvent } from 'react';
import { CloseIcon } from '@/components/icons';
import { useT } from '@/i18n';
import { isoToLocalInput, localInputToIso, tagTone } from '@/lib/training-list';
import { inputClass } from '../../agent-fields';

const SUGGESTIONS_SHOWN = 12;

/**
 * Editor de tags: Enter ou vírgula adiciona, Backspace no campo vazio remove a última. Aplica a
 * mesma normalização do servidor (minúsculas, sem duplicatas) para a tela mostrar o que será salvo.
 */
export function TagsField({
  value,
  onChange,
  suggestions = [],
  disabled,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  /** Tags já usadas no agente. */
  suggestions?: string[];
  disabled?: boolean;
}) {
  const t = useT('trainings');
  const inputId = useId();
  const [draft, setDraft] = useState('');
  const full = value.length >= TRAINING_TAGS_MAX;

  function commit(raw: string) {
    const added = normalizeTrainingTags(raw.split(',')).map((tag) =>
      tag.slice(0, TRAINING_TAG_MAX_LENGTH),
    );
    if (added.length === 0) return;
    onChange(normalizeTrainingTags([...value, ...added]).slice(0, TRAINING_TAGS_MAX));
    setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit(draft);
    } else if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  const unused = suggestions.filter((tag) => !value.includes(tag)).slice(0, SUGGESTIONS_SHOWN);

  return (
    <div className="text-sm">
      <label htmlFor={inputId} className="font-medium text-zinc-800">
        {t('fields.tagsLabel')}
      </label>
      <div
        className={`${inputClass} flex flex-wrap items-center gap-1.5 focus-within:border-brand-500 focus-within:ring-3 focus-within:ring-brand-100`}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tagTone(tag)}`}
          >
            {tag}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(value.filter((entry) => entry !== tag))}
              aria-label={t('fields.tagRemove', { tag })}
              className="rounded-full text-zinc-400 hover:text-zinc-700"
            >
              <CloseIcon className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          type="text"
          value={draft}
          disabled={disabled || full}
          maxLength={TRAINING_TAG_MAX_LENGTH}
          placeholder={value.length === 0 ? t('fields.tagsPlaceholder') : ''}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => commit(draft)}
          className="min-w-24 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-zinc-400"
        />
      </div>
      <p className="mt-1.5 text-xs text-zinc-500">
        {t('fields.tagsHint', { max: TRAINING_TAGS_MAX, length: TRAINING_TAG_MAX_LENGTH })}
      </p>
      {unused.length > 0 && !full && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-zinc-500">{t('fields.tagSuggestions')}</span>
          {unused.map((tag) => (
            <button
              key={tag}
              type="button"
              disabled={disabled}
              onClick={() => commit(tag)}
              className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A data já passou (com a tolerância de 1 min do servidor para o relógio do navegador). */
export function expiresInPast(localValue: string, now: Date = new Date()): boolean {
  const iso = localInputToIso(localValue);
  return iso !== null && Date.parse(iso) <= now.getTime() - 60_000;
}

/** Data e hora de expiração no horário do navegador; vazio, sem expiração. */
export function ExpiresAtField({
  value,
  onChange,
  disabled,
}: {
  /** Valor de `datetime-local`. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const t = useT('trainings');
  const inputId = useId();
  const past = expiresInPast(value);
  return (
    <div className="text-sm">
      <label htmlFor={inputId} className="font-medium text-zinc-800">
        {t('fields.expiresLabel')}
      </label>
      <input
        id={inputId}
        type="datetime-local"
        className={inputClass}
        value={value}
        min={isoToLocalInput(new Date().toISOString())}
        disabled={disabled}
        aria-invalid={past}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className={`mt-1.5 text-xs ${past ? 'text-red-600' : 'text-zinc-500'}`}>
        {past ? t('fields.expiresPast') : t('fields.expiresHint')}
      </p>
    </div>
  );
}
