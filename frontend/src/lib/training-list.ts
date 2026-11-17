import {
  TRAINING_PAGE_SIZE_DEFAULT,
  TRAINING_SEARCH_MAX,
  type TrainingView,
  normalizeTrainingTags,
  trainingStatusSchema,
  trainingTypeSchema,
} from '@gptmaker/contracts';

/** Filtros e página da lista de treinamentos; vivem na URL da tela (spec training-listing). */
export interface TrainingListFilters {
  page: number;
  q: string;
  type: TrainingView['type'][];
  status: TrainingView['status'][];
  tags: string[];
}

export const EMPTY_TRAINING_FILTERS: TrainingListFilters = {
  page: 1,
  q: '',
  type: [],
  status: [],
  tags: [],
};

function csv<T extends string>(value: string | null, accepts: (item: string) => item is T): T[] {
  if (!value) return [];
  return [...new Set(value.split(',').map((part) => part.trim()))].filter(accepts);
}

const isType = (item: string): item is TrainingView['type'] =>
  trainingTypeSchema.safeParse(item).success;
const isStatus = (item: string): item is TrainingView['status'] =>
  trainingStatusSchema.safeParse(item).success;

/** Lê a URL da tela; valor inválido vira o padrão em vez de quebrar a página. */
export function parseTrainingFilters(params: URLSearchParams): TrainingListFilters {
  const page = Number.parseInt(params.get('page') ?? '', 10);
  return {
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    q: (params.get('q') ?? '').slice(0, TRAINING_SEARCH_MAX),
    type: csv(params.get('type'), isType),
    status: csv(params.get('status'), isStatus),
    tags: normalizeTrainingTags((params.get('tags') ?? '').split(',')),
  };
}

/**
 * Query string dos filtros, sem os valores padrão. Serve para a URL da tela e, com `pageSize`,
 * para a chamada da API.
 */
export function trainingFiltersQuery(
  filters: TrainingListFilters,
  options: { pageSize?: number } = {},
): string {
  const params = new URLSearchParams();
  if (filters.page > 1) params.set('page', String(filters.page));
  if (options.pageSize && options.pageSize !== TRAINING_PAGE_SIZE_DEFAULT) {
    params.set('pageSize', String(options.pageSize));
  }
  const q = filters.q.trim();
  if (q) params.set('q', q);
  if (filters.type.length) params.set('type', filters.type.join(','));
  if (filters.status.length) params.set('status', filters.status.join(','));
  if (filters.tags.length) params.set('tags', filters.tags.join(','));
  return params.toString();
}

/** Muda filtros e volta à página 1; mudar só a página mantém os filtros. */
export function changeTrainingFilters(
  current: TrainingListFilters,
  patch: Partial<Omit<TrainingListFilters, 'page'>>,
): TrainingListFilters {
  return { ...current, ...patch, page: 1 };
}

export function hasActiveTrainingFilters(filters: TrainingListFilters): boolean {
  return (
    filters.q.trim() !== '' ||
    filters.type.length > 0 ||
    filters.status.length > 0 ||
    filters.tags.length > 0
  );
}

/** Liga/desliga um item de uma lista de filtro. */
export function toggleItem<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];
}

/** Quanto falta para expirar, para o aviso na linha; `null` se já passou ou não há data. */
export function expiresInDays(expiresAt: string | null, now: Date = new Date()): number | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt) - now.getTime();
  return ms <= 0 ? null : Math.ceil(ms / 86_400_000);
}

/** Valor de um `<input type="datetime-local">` (horário do navegador) para ISO em UTC. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** ISO em UTC para o valor de um `<input type="datetime-local">` (horário do navegador). */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
