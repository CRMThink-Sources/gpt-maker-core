import {
  CALENDAR_MAX_DAYS_AHEAD,
  CALENDAR_MIN_NOTICE_MINUTES,
  CALENDAR_SLOT_MINUTES,
  CALENDAR_USERS_MAX,
  type CalendarConfig,
  type CalendarConfigInput,
  type CalendarConfigView,
} from '@gptmaker/contracts';
import { createT, type T } from '@/i18n';
import type { PlatformSessionClient } from './platform-session';

/** `api` da sessão do iframe (`useAppSession().api`). */
type Api = PlatformSessionClient['api'];

const path = (agentId: string) => `/app/agents/${encodeURIComponent(agentId)}/calendar`;

/** Agenda do agente no Calendário do Bitrix24 (spec agent-calendar-scheduling). */
export function getCalendarConfig(api: Api, agentId: string): Promise<CalendarConfigView> {
  return api<CalendarConfigView>(path(agentId));
}

export function saveCalendarConfig(
  api: Api,
  agentId: string,
  body: CalendarConfigInput,
): Promise<CalendarConfigView> {
  return api<CalendarConfigView>(path(agentId), { method: 'PUT', body: JSON.stringify(body) });
}

export function removeCalendarConfig(api: Api, agentId: string): Promise<CalendarConfigView> {
  return api<CalendarConfigView>(path(agentId), { method: 'DELETE' });
}

/** Nomes do `user.get` do portal (ids em texto) como mapa por número, para os seletores. */
export function toNameMap(found: Record<string, string>): Record<number, string> {
  return Object.fromEntries(Object.entries(found).map(([id, name]) => [Number(id), name]));
}

/** Sem `t` vale o pt-BR do namespace `calendar`. */
const fallbackT = createT('pt-BR', 'calendar');

interface ValidationIssue {
  code: string;
  path: PropertyKey[];
  message: string;
}

const NUMBER_FIELDS: Record<
  string,
  { int: string; small: string; big: string; step?: string; limits: Record<string, number> }
> = {
  slotMinutes: {
    int: 'validation.slotInt',
    small: 'validation.slotMin',
    big: 'validation.slotMax',
    step: 'validation.slotStep',
    limits: CALENDAR_SLOT_MINUTES,
  },
  minNoticeMinutes: {
    int: 'validation.noticeInt',
    small: 'validation.noticeNegative',
    big: 'validation.noticeMax',
    limits: CALENDAR_MIN_NOTICE_MINUTES,
  },
  maxDaysAhead: {
    int: 'validation.daysInt',
    small: 'validation.daysMin',
    big: 'validation.daysMax',
    limits: CALENDAR_MAX_DAYS_AHEAD,
  },
};

/**
 * Mensagem de uma falha do contrato (`calendarConfigInputSchema`) no idioma de `t`; o contrato só
 * traz pt-BR. Sem tradução conhecida, devolve a mensagem do próprio contrato.
 */
export function calendarValidationMessage(
  issue: ValidationIssue,
  input: CalendarConfigInput,
  t: T = fallbackT,
): string {
  const field = String(issue.path[0]);
  const numeric = NUMBER_FIELDS[field];
  if (numeric) {
    const key =
      issue.code === 'too_small'
        ? numeric.small
        : issue.code === 'too_big'
          ? numeric.big
          : issue.code === 'not_multiple_of' && numeric.step
            ? numeric.step
            : numeric.int;
    return t(key, numeric.limits);
  }
  if (field === 'userIds') {
    const ids = input.userIds ?? [];
    if (new Set(ids).size !== ids.length) return t('validation.usersRepeated');
    if (input.mode === 'FIXED_USER' && ids.length !== 1) return t('validation.usersFixed');
    if (input.mode === 'USER_LIST' && (ids.length < 1 || ids.length > CALENDAR_USERS_MAX)) {
      return t('validation.usersList', { max: CALENDAR_USERS_MAX });
    }
    if (input.mode === 'CLIENT_OWNER' && ids.length > 0) return t('validation.usersOwner');
  }
  return issue.message;
}

/** Valores do formulário como o usuário os digita (números em texto, para poder apagar). */
export interface CalendarDraft {
  mode: CalendarConfig['mode'];
  userIds: number[];
  slotMinutes: string;
  minNoticeMinutes: string;
  maxDaysAhead: string;
}

export function draftOf(config: CalendarConfig | null): CalendarDraft {
  return {
    mode: config?.mode ?? 'FIXED_USER',
    userIds: config?.userIds ?? [],
    slotMinutes: String(config?.slotMinutes ?? 30),
    minNoticeMinutes: String(config?.minNoticeMinutes ?? 60),
    maxDaysAhead: String(config?.maxDaysAhead ?? 7),
  };
}

/** Corpo da API a partir do formulário; `null` se algum número não foi preenchido. */
export function inputOf(draft: CalendarDraft): CalendarConfigInput | null {
  const numbers = [draft.slotMinutes, draft.minNoticeMinutes, draft.maxDaysAhead].map((value) =>
    value.trim() === '' ? Number.NaN : Number(value),
  );
  if (numbers.some((value) => !Number.isFinite(value))) return null;
  const [slotMinutes, minNoticeMinutes, maxDaysAhead] = numbers as [number, number, number];
  return {
    mode: draft.mode,
    // No modo "responsável do cliente" não há usuários para escolher.
    userIds: draft.mode === 'CLIENT_OWNER' ? [] : draft.userIds,
    slotMinutes,
    minNoticeMinutes,
    maxDaysAhead,
  };
}

function minutes(value: number, t: T): string {
  if (value === 0) return t('summary.noNotice');
  if (value % 60 === 0) return t('summary.hours', { count: value / 60 });
  return t('summary.minutes', { count: value });
}

/** Linhas do resumo da agenda salva: de quem é e as regras dos horários. */
export function describeCalendar(
  config: CalendarConfig,
  names: Record<number, string>,
  t: T = fallbackT,
): { owner: string; rules: string } {
  const named = (id: number) => names[id] ?? t('summary.user', { id });
  const owner =
    config.mode === 'CLIENT_OWNER'
      ? t('summary.clientOwner')
      : config.userIds.map(named).join(', ');
  return {
    owner,
    rules: t('summary.rules', {
      slot: config.slotMinutes,
      notice: minutes(config.minNoticeMinutes, t),
      days: t('summary.days', { count: config.maxDaysAhead }),
    }),
  };
}
