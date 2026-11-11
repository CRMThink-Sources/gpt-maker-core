import {
  CALENDAR_MODE_LABELS,
  type CalendarConfig,
  type CalendarConfigInput,
  type CalendarConfigView,
} from '@gptmaker/contracts';
import { errorMessage } from './agents';
import { ApiRequestError, type PlatformSessionClient } from './platform-session';

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

const MESSAGES: Record<string, string> = {
  CALENDAR_CRM_REQUIRED: 'Ligue o acesso ao CRM deste agente para configurar a agenda.',
  CALENDAR_USER_INVALID:
    'Há usuários que não existem no Bitrix24 ou estão inativos. Escolha outros usuários.',
  CALENDAR_PORTAL_UNAVAILABLE: 'O Bitrix24 não respondeu agora. Aguarde um pouco e tente de novo.',
};

/** Mensagem para o usuário nas telas da agenda. */
export function calendarErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError && MESSAGES[error.code]) return MESSAGES[error.code]!;
  return errorMessage(error, fallback);
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

function minutes(value: number): string {
  if (value === 0) return 'sem antecedência';
  if (value % 60 === 0) return `${value / 60} ${value === 60 ? 'hora' : 'horas'}`;
  return `${value} minutos`;
}

/** Linhas do resumo da agenda salva: de quem é e as regras dos horários. */
export function describeCalendar(
  config: CalendarConfig,
  names: Record<number, string>,
): { owner: string; rules: string } {
  const named = (id: number) => names[id] ?? `usuário #${id}`;
  const owner =
    config.mode === 'CLIENT_OWNER'
      ? 'o responsável pelo cliente no CRM'
      : config.userIds.map(named).join(', ');
  const days = config.maxDaysAhead === 1 ? '1 dia' : `${config.maxDaysAhead} dias`;
  return {
    owner,
    rules:
      `Compromissos de ${config.slotMinutes} minutos · antecedência mínima: ` +
      `${minutes(config.minNoticeMinutes)} · busca de até ${days} à frente.`,
  };
}

export { CALENDAR_MODE_LABELS };
