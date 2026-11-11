import { Inject, Injectable } from '@nestjs/common';
import type { BusinessHours } from '@gptmaker/contracts';
import type Redis from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DB, type Database } from '../../shared/database/database.module';
import { REDIS } from '../../shared/redis/redis.module';
import { AgentRepository } from '../agents';
import { BitrixClient, BitrixError } from '../bitrix';
import {
  addDays,
  type AgendaBusy,
  DEFAULT_CALENDAR_HOURS,
  freeSlots,
  type Interval,
  localParts,
  searchWindow,
} from './calendar-slots';
import { CalendarConfigRepository, type CalendarConfigRow } from './calendar-config.repository';
import { CalendarConfigService } from './calendar-config.service';
import type { CrmCaller } from './crm-access.guard';
import { CrmToolsService } from './crm-tools.service';
import { ToolRunner, type ToolResult } from './tool-runner';

/** Ocupam o horário: o evento está como ocupado ou ausente (livre e provisório não bloqueiam). */
const BLOCKING = new Set(['busy', 'absent']);

const WEEK_DAY_NAMES = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

const TEAM_WILL_CONTACT = 'Avise o cliente que a equipe vai retornar o contato.';

const NOT_CONFIGURED: ToolResult = {
  outcome: 'not_found',
  count: 0,
  body: { erro: `A agenda deste agente não está configurada. ${TEAM_WILL_CONTACT}` },
};

const SCOPE_MISSING: ToolResult = {
  outcome: 'unavailable',
  count: 0,
  body: {
    erro: `O calendário do Bitrix24 não está liberado para este aplicativo. ${TEAM_WILL_CONTACT}`,
  },
};

const CLIENT_NOT_FOUND: ToolResult = {
  outcome: 'not_found',
  count: 0,
  body: {
    erro: 'Cliente não encontrado. Use a referência devolvida por "Consultar cliente no CRM".',
  },
};

const NO_AGENDA: ToolResult = {
  outcome: 'not_found',
  count: 0,
  body: { erro: `Não há agenda disponível para este cliente. ${TEAM_WILL_CONTACT}` },
};

const GUIDANCE =
  'Ofereça ao cliente até 3 destes horários e peça que ele escolha. Só use "agendar_compromisso" ' +
  'depois que o cliente confirmar data e hora. Não invente horários que não estão na lista.';

interface PortalUser {
  ID: string | number;
  NAME?: string;
  LAST_NAME?: string;
}

interface AccessibilityEvent {
  ACCESSIBILITY?: string;
  DATE_FROM_TS_UTC?: string | number;
  DATE_TO_TS_UTC?: string | number;
}

/**
 * Ferramentas de agenda do agente sobre o Calendário do Bitrix24 (spec agent-calendar-scheduling,
 * design D1/D3). Rodam no mesmo executor das ferramentas do CRM: o limite por agente soma as duas.
 * O tenant e o agente vêm sempre da credencial já verificada (`CrmCaller`).
 */
@Injectable()
export class CalendarToolsService {
  private readonly runner: ToolRunner;
  /** Relógio; os testes o trocam. */
  clock: () => number = () => Date.now();

  constructor(
    private readonly crm: CrmToolsService,
    private readonly bitrix: BitrixClient,
    private readonly config: CalendarConfigService,
    private readonly configs: CalendarConfigRepository,
    private readonly agents: AgentRepository,
    @Inject(DB) db: Database,
    @Inject(REDIS) redis: Redis,
    @Inject(ENV) env: Env,
  ) {
    this.runner = new ToolRunner(db, redis, env);
  }

  /** Ferramenta `horarios_livres`: até 10 horários livres a partir da agenda configurada. */
  freeSlots(caller: CrmCaller, input: { cliente?: unknown; aPartirDe?: unknown } = {}) {
    return this.runner.run(caller, 'horarios_livres', () => this.findFreeSlots(caller, input));
  }

  private async findFreeSlots(
    caller: CrmCaller,
    input: { cliente?: unknown; aPartirDe?: unknown },
  ): Promise<ToolResult> {
    const cfg = await this.configs.find(caller.tenantId, caller.agentId);
    if (!cfg) return NOT_CONFIGURED;

    const agent = await this.agents.getById(caller.tenantId, caller.agentId);
    const hours: BusinessHours = agent.businessHours ?? DEFAULT_CALENDAR_HOURS;
    const now = this.clock();
    const window = searchWindow(now, hours.timezone, cfg.maxDaysAhead);

    const from = parseDate(input.aPartirDe);
    if (from === 'invalid' || (from && (from < window.first || from > window.last))) {
      return {
        outcome: 'not_found',
        count: 0,
        body: {
          erro: 'Data fora do período em que há agenda.',
          periodo_permitido: { de: window.first, ate: window.last },
        },
      };
    }

    try {
      const owners = await this.owners(caller, cfg, input.cliente);
      if ('result' in owners) return owners.result;
      if (owners.users.length === 0) return NO_AGENDA;

      const agendas = await this.busy(caller, owners.users, window);
      const slots = freeSlots({
        now,
        from: from ?? undefined,
        hours,
        slotMinutes: cfg.slotMinutes,
        minNoticeMinutes: cfg.minNoticeMinutes,
        maxDaysAhead: cfg.maxDaysAhead,
        agendas,
      });
      await this.scopeWorked(caller, cfg);

      const names = new Map(owners.users.map((user) => [user.id, user.name]));
      return {
        outcome: 'ok',
        count: slots.length,
        body: {
          fuso_horario: hours.timezone,
          duracao_minutos: cfg.slotMinutes,
          periodo: { de: window.first, ate: window.last },
          horarios: slots.map((slot) => {
            const start = localParts(slot.start, hours.timezone);
            return {
              data: start.data,
              dia_da_semana: weekDayName(start.data),
              hora_inicio: start.hora,
              hora_fim: localParts(slot.end, hours.timezone).hora,
              com: names.get(slot.ownerId),
            };
          }),
          ...(slots.length === 0
            ? { mensagem: `Não há horários disponíveis no período. ${TEAM_WILL_CONTACT}` }
            : { orientacao: GUIDANCE }),
        },
      };
    } catch (error) {
      if (error instanceof BitrixError && error.isScopeMissing) {
        await this.config.markScopeMissing(caller.tenantId, caller.agentId);
        return SCOPE_MISSING;
      }
      throw error;
    }
  }

  /**
   * Usuários cuja agenda vale nesta chamada, conforme o modo (design D5), já filtrados pelos que
   * existem e estão ativos no portal. Na ordem configurada (a primeira agenda livre vence).
   */
  private async owners(
    caller: CrmCaller,
    cfg: CalendarConfigRow,
    cliente: unknown,
  ): Promise<{ users: Array<{ id: number; name: string }> } | { result: ToolResult }> {
    let ids = cfg.userIds;
    if (cfg.mode === 'CLIENT_OWNER') {
      const responsible = await this.crm.clientResponsible(caller, cliente);
      if (!responsible.found) return { result: CLIENT_NOT_FOUND };
      if (responsible.userId === null) return { result: NO_AGENDA };
      ids = [responsible.userId];
    }
    const { result } = await this.bitrix.call<PortalUser[]>(caller.installationId, 'user.get', {
      FILTER: { ID: ids, ACTIVE: true },
    });
    const active = new Map(
      (Array.isArray(result) ? result : []).map((user) => [
        Number(user.ID),
        [user.NAME, user.LAST_NAME].filter(Boolean).join(' ').trim() || 'a equipe',
      ]),
    );
    return {
      users: ids.filter((id) => active.has(id)).map((id) => ({ id, name: active.get(id)! })),
    };
  }

  /** Períodos ocupados de cada usuário na janela, em UTC, só com os eventos que bloqueiam. */
  private async busy(
    caller: CrmCaller,
    users: Array<{ id: number }>,
    window: { first: string; last: string },
  ): Promise<AgendaBusy[]> {
    // A API recebe só datas: uma folga de um dia de cada lado cobre o deslocamento do fuso.
    const { result } = await this.bitrix.call<
      Record<string, AccessibilityEvent[]> | AccessibilityEvent[]
    >(caller.installationId, 'calendar.accessibility.get', {
      users: users.map((user) => user.id),
      from: addDays(window.first, -1),
      to: addDays(window.last, 1),
    });
    const byUser = Array.isArray(result) ? {} : (result ?? {});
    return users.map((user) => ({
      ownerId: user.id,
      busy: (byUser[String(user.id)] ?? [])
        .filter((event) => BLOCKING.has(String(event.ACCESSIBILITY)))
        .map((event): Interval => ({
          start: Number(event.DATE_FROM_TS_UTC) * 1000,
          end: Number(event.DATE_TO_TS_UTC) * 1000,
        }))
        .filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end)),
    }));
  }

  /** Uma chamada ao Calendário funcionou: o aviso de escopo ausente some. */
  private async scopeWorked(caller: CrmCaller, cfg: CalendarConfigRow): Promise<void> {
    if (cfg.lastScopeErrorAt) {
      await this.config.clearScopeMissing(caller.tenantId, caller.agentId);
    }
  }
}

/** `AAAA-MM-DD` válido; ausente = `null`; qualquer outra coisa = `'invalid'`. */
function parseDate(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'invalid';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? 'invalid'
    : value;
}

function weekDayName(date: string): string {
  return WEEK_DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
}
