'use client';

import { type TrainingPageInfo, type TrainingView } from '@gptmaker/contracts';
import { buttonClass } from '@/components/ui';
import { useT } from '@/i18n';
import {
  hasActiveTrainingFilters,
  tagTone,
  toggleItem,
  type TrainingListFilters,
} from '@/lib/training-list';
import { inputClass } from '../../agent-fields';

const TYPES: TrainingView['type'][] = ['TEXT', 'WEBSITE', 'VIDEO', 'DOCUMENT'];
const STATUSES: TrainingView['status'][] = ['PROCESSING', 'DONE', 'FAILED', 'EXPIRED'];
const STATUS_KEY: Record<TrainingView['status'], string> = {
  PROCESSING: 'processing',
  DONE: 'done',
  FAILED: 'failed',
  EXPIRED: 'expired',
};

/** Busca, tipo, estado e tags; cada mudança volta à página 1 (quem usa aplica em `onChange`). */
export function TrainingFilters({
  filters,
  search,
  onSearch,
  availableTags,
  onChange,
  onClear,
}: {
  filters: TrainingListFilters;
  /** Texto digitado, ainda sem debounce. */
  search: string;
  onSearch: (value: string) => void;
  availableTags: string[];
  onChange: (patch: Partial<Omit<TrainingListFilters, 'page'>>) => void;
  onClear: () => void;
}) {
  const t = useT('trainings');
  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={t('page.searchPlaceholder')}
          aria-label={t('page.searchLabel')}
          className={`${inputClass} mt-0 min-w-56 flex-1`}
        />
        <select
          aria-label={t('page.typeLabel')}
          value={filters.type.length === 1 ? filters.type[0] : ''}
          onChange={(e) =>
            onChange({ type: e.target.value ? [e.target.value as TrainingView['type']] : [] })
          }
          className={`${inputClass} mt-0 w-auto!`}
        >
          <option value="">{t('page.allTypes')}</option>
          {TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`types.${type}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('page.statusLabel')}
          value={filters.status.length === 1 ? filters.status[0] : ''}
          onChange={(e) =>
            onChange({ status: e.target.value ? [e.target.value as TrainingView['status']] : [] })
          }
          className={`${inputClass} mt-0 w-auto!`}
        >
          <option value="">{t('page.allStatuses')}</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`status.${STATUS_KEY[status]}`)}
            </option>
          ))}
        </select>
        {hasActiveTrainingFilters(filters) && (
          <button type="button" onClick={onClear} className={buttonClass('ghost', 'sm')}>
            {t('page.clearFilters')}
          </button>
        )}
      </div>
      {availableTags.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label={t('page.tagsLabel')}
        >
          {availableTags.map((tag) => {
            const on = filters.tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ tags: toggleItem(filters.tags, tag) })}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-2 transition-colors ${tagTone(tag)} ${
                  on ? 'ring-zinc-700' : 'ring-transparent'
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Total de itens e navegação entre páginas (só aparece com mais de uma). */
export function TrainingPagination({
  info,
  onPage,
}: {
  info: TrainingPageInfo;
  onPage: (page: number) => void;
}) {
  const t = useT('trainings');
  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-sm text-zinc-500">
      <span>{t('page.total', { total: info.total })}</span>
      {info.totalPages > 1 && (
        <>
          <button
            type="button"
            onClick={() => onPage(info.page - 1)}
            disabled={info.page <= 1}
            className={buttonClass('secondary', 'sm')}
          >
            {t('page.previous')}
          </button>
          <span>{t('page.pageOf', { page: info.page, totalPages: info.totalPages })}</span>
          <button
            type="button"
            onClick={() => onPage(info.page + 1)}
            disabled={info.page >= info.totalPages}
            className={buttonClass('secondary', 'sm')}
          >
            {t('page.next')}
          </button>
        </>
      )}
    </div>
  );
}
