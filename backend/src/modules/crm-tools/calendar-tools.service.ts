import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BusinessHours } from '@gptmaker/contracts';
import type Redis from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DB, type Database } from '../../shared/database/database.module';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { AgentRepository } from '../agents';
import { BitrixClient, BitrixError } from '../bitrix';
import {
  addDays,
  type AgendaBusy,
  DEFAULT_CALENDAR_HOURS,
  eventInterval,
  type FreeSlot,
  freeSlots,
  type Interval,
  localDate,
  localParts,
  searchWindow,
  slotViolation,
  spokenTime,
  spokenWhen,
  type SlotViolation,
  zonedToEpoch,
} from './calendar-slots';
import { CalendarConfigRepository, type CalendarConfigRow } from './calendar-config.repository';
import { CalendarConfigService } from './calendar-config.service';
import type { CrmCaller } from './crm-access.guard';
import { CrmGuidanceService } from './crm-guidance.service';
import { CrmToolsService } from './crm-tools.service';
import { ToolRunner, type ToolResult } from './tool-runner';

/** Ocupam o horário: o evento está como ocupado ou ausente (livre e provisório não bloqueiam). */
const BLOCKING = new Set(['busy', 'absent']);

/** Prefixo do vínculo de um evento do Calendário com o registro do CRM (`crm_fields`). */
const CRM_PREFIX = { contact: 'C_', lead: 'L_', company: 'CO_' } as const;

/** O lock cobre a releitura da ocupação e a criação; expira sozinho se o processo morrer. */
const LOCK_TTL_MS = 30_000;
/** Quanto uma chamada espera por outra que mexe na mesma agenda (a ferramenta tem 10 s). */
const LOCK_WAIT_MS = 3_000;
/** Depois disso não se começa a criar: o agente já pode ter recebido "indisponível". */
const SOFT_DEADLINE_MS = 5_000;
/**
 * Quanto tempo a mesma chamada de agendamento devolve o mesmo resultado. Curto de propósito: cobre
 * a repetição do GPTMaker e a insistência do agente, e não confirma por horas um compromisso que a
 * equipe já apagou ou remarcou no Bitrix24.
 */
const BOOKED_TTL_SECONDS = 15 * 60;
const MAX_ALTERNATIVES = 3;
/** `agendamentos_do_cliente`: compromissos por resposta e quantos dias à frente se olha. */
const MAX_APPOINTMENTS = 10;
const APPOINTMENTS_WINDOW_DAYS = 60;
/** `OWNER_TYPE_ID` das atividades do CRM por tipo de cliente (entidades do Bitrix24). */
const CRM_OWNER_TYPE = { lead: 1, contact: 3, company: 4 } as const;
const TITLE_MAX = 100;
const SUBJECT_MAX = 200;

const TEAM_WILL_CONTACT = 'Avise o cliente que a equipe vai retornar o contato.';

const result = (outcome: ToolResult['outcome'], body: Record<string, unknown>, count = 0) =>
  ({ outcome, count, body }) satisfies ToolResult;

const NOT_CONFIGURED = result('not_found', {
  erro: `A agenda deste agente não está configurada. ${TEAM_WILL_CONTACT}`,
});
const SCOPE_MISSING = result('unavailable', {
  erro: `O calendário do Bitrix24 não está liberado para este aplicativo. ${TEAM_WILL_CONTACT}`,
});
const CLIENT_NOT_FOUND = result('not_found', {
  erro: 'Cliente não encontrado. Use a referência devolvida por "Consultar cliente no CRM".',
});
const NO_AGENDA = result('not_found', {
  erro: `Não há agenda disponível para este cliente. ${TEAM_WILL_CONTACT}`,
});
const BOOK_FAILED = result('unavailable', {
  erro: `Não foi possível agendar agora. ${TEAM_WILL_CONTACT}`,
});
const LOCK_BUSY = result('unavailable', {
  erro: 'Outro agendamento está sendo finalizado nesta agenda. Tente de novo em instantes.',
});

interface PortalUser {
  ID: string | number;
  NAME?: string;
  LAST_NAME?: string;
}

interface ClientActivity {
  START_TIME?: string;
  END_TIME?: string;
  RESPONSIBLE_ID?: string | number;
}

interface AccessibilityEvent {
  ACCESSIBILITY?: string;
  DATE_FROM_TS_UTC?: string | number;
  DATE_TO_TS_UTC?: string | number;
  '~USER_OFFSET_FROM'?: string | number;
  TZ_FROM?: string;
  DATE_FROM?: string;
  DATE_TO?: string;
}

interface AgendaUser {
  id: number;
  name: string;
}

type Client = Extract<Awaited<ReturnType<CrmToolsService['calendarClient']>>, { found: true }>;

type Locked =
  | { kind: 'booked' | 'done'; result: ToolResult }
  | { kind: 'taken' | 'slow' | 'scope' | 'failed' }
  | { kind: 'denied'; owner: string };

/**
 * Ferramentas de agenda do agente sobre o Calendário do Bitrix24 (spec agent-calendar-scheduling,
 * design D1 a D5). Rodam no mesmo executor das ferramentas do CRM: o limite por agente soma as
 * duas. O tenant e o agente vêm sempre da credencial já verificada (`CrmCaller`).
 */
@Injectable()
export class CalendarToolsService {
  private readonly logger = new Logger(CalendarToolsService.name);
  private readonly runner: ToolRunner;
  private readonly lock: DistributedLock;
  /** Relógio; os testes o trocam. */
  clock: () => number = () => Date.now();

  constructor(
    private readonly crm: CrmToolsService,
    private readonly bitrix: BitrixClient,
    private readonly config: CalendarConfigService,
    private readonly configs: CalendarConfigRepository,
    private readonly agents: AgentRepository,
    @Inject(DB) db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) env: Env,
    private readonly guidance: CrmGuidanceService,
  ) {
    this.runner = new ToolRunner(db, redis, env);
    this.lock = new DistributedLock(redis);
  }

  /** Ferramenta `horarios_livres`: até 10 horários livres a partir da agenda configurada. */
  freeSlots(caller: CrmCaller, input: { cliente?: unknown; aPartirDe?: unknown } = {}) {
    return this.runner.run(caller, 'horarios_livres', () => this.findFreeSlots(caller, input));
  }

  /** Ferramenta `agendar_compromisso`: cria o evento num horário livre, no máximo uma vez. */
  book(caller: CrmCaller, input: { cliente?: unknown; inicio?: unknown; assunto?: unknown } = {}) {
    return this.runner.run(caller, 'agendar_compromisso', () =>
      this.createAppointment(caller, input),
    );
  }

  /** Ferramenta `agendamentos_do_cliente`: compromissos futuros do cliente nas agendas do agente. */
  clientAppointments(caller: CrmCaller, input: { cliente?: unknown } = {}) {
    return this.runner.run(caller, 'agendamentos_do_cliente', () =>
      this.listClientAppointments(caller, input),
    );
  }

  /**
   * Lê as atividades do CRM do cliente (design D6): um evento do Calendário vinculado a ele vira uma
   * atividade `CRM_TODO` com início, fim e responsável, e acompanha edição e exclusão do evento.
   * Não devolve título nem descrição (o evento privado também gera atividade). Janela e responsável
   * são conferidos de novo aqui: o que o Bitrix24 devolver fora do pedido não chega ao agente.
   */
  private async listClientAppointments(
    caller: CrmCaller,
    input: { cliente?: unknown },
  ): Promise<ToolResult> {
    const cfg = await this.configs.find(caller.tenantId, caller.agentId);
    if (!cfg) return NOT_CONFIGURED;

    const hours = await this.hoursOf(caller);
    const client = await this.crm.calendarClient(caller, input.cliente);
    if (!client.found) return CLIENT_NOT_FOUND;
    const agenda = await this.agendaUsers(caller, cfg, client);
    if ('result' in agenda) return agenda.result;
    if (agenda.users.length === 0) return NO_AGENDA;

    const now = this.clock();
    const until = now + APPOINTMENTS_WINDOW_DAYS * 24 * 60 * 60_000;
    const { result: rows, total } = await this.bitrix.call<ClientActivity[]>(
      caller.installationId,
      'crm.activity.list',
      {
        filter: {
          OWNER_TYPE_ID: CRM_OWNER_TYPE[client.type],
          OWNER_ID: client.id,
          PROVIDER_ID: 'CRM_TODO',
          RESPONSIBLE_ID: agenda.users.map((user) => user.id),
          '>=START_TIME': isoWithOffset(now),
          '<=START_TIME': isoWithOffset(until),
        },
        order: { START_TIME: 'ASC' },
        select: ['ID', 'START_TIME', 'END_TIME', 'RESPONSIBLE_ID'],
      },
    );

    const names = new Map(agenda.users.map((user) => [user.id, user.name]));
    const upcoming = (Array.isArray(rows) ? rows : [])
      .map((row) => ({
        start: Date.parse(String(row.START_TIME)),
        end: Date.parse(String(row.END_TIME)),
        owner: Number(row.RESPONSIBLE_ID),
      }))
      .filter(
        (row) =>
          Number.isFinite(row.start) &&
          Number.isFinite(row.end) &&
          row.start >= now &&
          row.start <= until &&
          names.has(row.owner),
      )
      .sort((a, b) => a.start - b.start);

    const shown = upcoming.slice(0, MAX_APPOINTMENTS);
    const more =
      upcoming.length > shown.length || (total ?? 0) > (Array.isArray(rows) ? rows.length : 0);
    return result(
      'ok',
      {
        fuso_horario: hours.timezone,
        agendamentos: shown.map((row) => {
          const start = localParts(row.start, hours.timezone);
          return {
            quando: spokenWhen(start.data, start.hora, currentYear(now, hours.timezone)),
            termina_as: spokenTime(localParts(row.end, hours.timezone).hora),
            duracao_minutos: Math.max(0, Math.round((row.end - row.start) / 60_000)),
            com: names.get(row.owner),
          };
        }),
        ...(more ? { ha_mais: true } : {}),
        ...(shown.length === 0
          ? { mensagem: 'Não há agendamentos futuros deste cliente.' }
          : {
              orientacao:
                'Informe ao cliente apenas data, hora e com quem é o compromisso. Não há título nem detalhes.',
            }),
      },
      shown.length,
    );
  }

  private async findFreeSlots(
    caller: CrmCaller,
    input: { cliente?: unknown; aPartirDe?: unknown },
  ): Promise<ToolResult> {
    const cfg = await this.configs.find(caller.tenantId, caller.agentId);
    if (!cfg) return NOT_CONFIGURED;

    const hours = await this.hoursOf(caller);
    const now = this.clock();
    const window = searchWindow(now, hours.timezone, cfg.maxDaysAhead);

    const from = parseDate(input.aPartirDe);
    if (from === 'invalid' || (from && (from < window.first || from > window.last))) {
      return result('not_found', {
        erro: 'Data fora do período em que há agenda.',
        periodo_permitido: { de: window.first, ate: window.last },
      });
    }

    try {
      let client: Client | null = null;
      if (cfg.mode === 'CLIENT_OWNER') {
        const found = await this.crm.calendarClient(caller, input.cliente);
        if (!found.found) return CLIENT_NOT_FOUND;
        client = found;
      }
      const agenda = await this.agendaUsers(caller, cfg, client);
      if ('result' in agenda) return agenda.result;
      if (agenda.users.length === 0) return NO_AGENDA;

      const agendas = await this.busy(caller, agenda.users, window.first, window.last);
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

      const names = new Map(agenda.users.map((user) => [user.id, user.name]));
      return result(
        'ok',
        {
          fuso_horario: hours.timezone,
          duracao_minutos: cfg.slotMinutes,
          periodo: { de: window.first, ate: window.last },
          horarios: slots.map((slot) =>
            slotView(slot, hours.timezone, names, currentYear(now, hours.timezone)),
          ),
          ...(slots.length === 0
            ? { mensagem: `Não há horários disponíveis no período. ${TEAM_WILL_CONTACT}` }
            : { orientacao: (await this.guidance.current()).agenda }),
        },
        slots.length,
      );
    } catch (error) {
      if (error instanceof BitrixError && error.isScopeMissing) {
        await this.config.markScopeMissing(caller.tenantId, caller.agentId);
        return SCOPE_MISSING;
      }
      throw error;
    }
  }

  private async createAppointment(
    caller: CrmCaller,
    input: { cliente?: unknown; inicio?: unknown; assunto?: unknown },
  ): Promise<ToolResult> {
    const startedAt = Date.now();
    const cfg = await this.configs.find(caller.tenantId, caller.agentId);
    if (!cfg) return NOT_CONFIGURED;

    const hours = await this.hoursOf(caller);
    const now = this.clock();
    const start = parseLocalStart(input.inicio, hours.timezone);
    if (start === null) {
      return result('not_found', {
        erro: 'Informe o início como AAAA-MM-DD HH:mm, no horário da agenda.',
        fuso_horario: hours.timezone,
      });
    }
    const rules = {
      now,
      hours,
      slotMinutes: cfg.slotMinutes,
      minNoticeMinutes: cfg.minNoticeMinutes,
      maxDaysAhead: cfg.maxDaysAhead,
    };
    const violation = slotViolation(rules, start);
    if (violation) return invalidSlot(violation, rules, hours);

    try {
      const client = await this.crm.calendarClient(caller, input.cliente);
      if (!client.found) return CLIENT_NOT_FOUND;

      const key = bookedKey(caller, client, start);
      const repeated = await this.alreadyBooked(key);
      if (repeated) return repeated;

      const agenda = await this.agendaUsers(caller, cfg, client);
      if ('result' in agenda) return agenda.result;
      if (agenda.users.length === 0) return NO_AGENDA;

      const locks = agenda.users.map((user) => `calendar:${caller.tenantId}:${user.id}`).sort();
      const outcome = await this.withLocks(locks, () =>
        this.bookLocked({
          caller,
          cfg,
          hours,
          client,
          start,
          key,
          users: agenda.users,
          startedAt,
          subject: cleanSubject(input.assunto),
        }),
      );
      if (!outcome.ran) return LOCK_BUSY;

      const done = outcome.result;
      switch (done.kind) {
        case 'booked':
        case 'done':
          if (done.kind === 'booked') await this.scopeWorked(caller, cfg);
          return done.result;
        case 'taken':
          return this.alternatives(caller, { cfg, hours, now, users: agenda.users, start });
        case 'scope':
          await this.config.markScopeMissing(caller.tenantId, caller.agentId);
          return SCOPE_MISSING;
        case 'denied':
          return result('unavailable', {
            erro: `O aplicativo não tem permissão para marcar na agenda de ${done.owner}. ${TEAM_WILL_CONTACT}`,
          });
        case 'slow':
        case 'failed':
          return BOOK_FAILED;
      }
    } catch (error) {
      if (error instanceof BitrixError && error.isScopeMissing) {
        await this.config.markScopeMissing(caller.tenantId, caller.agentId);
        return SCOPE_MISSING;
      }
      throw error;
    }
  }

  /**
   * Dentro do lock da agenda (design D4): confere de novo a repetição (uma chamada que esperou o
   * lock já encontra a primeira pronta), relê a ocupação do dia, escolhe o primeiro usuário livre e
   * cria. Se a criação falhar no meio (tempo esgotado), o evento pode existir mesmo assim; a
   * releitura da próxima tentativa o enxerga como ocupado e não cria outro.
   */
  private async bookLocked(args: {
    caller: CrmCaller;
    cfg: CalendarConfigRow;
    hours: BusinessHours;
    client: Client;
    start: number;
    key: string;
    users: AgendaUser[];
    startedAt: number;
    subject: string | null;
  }): Promise<Locked> {
    const { caller, cfg, hours, client, start, key, users, subject } = args;
    const repeated = await this.alreadyBooked(key);
    if (repeated) return { kind: 'done', result: repeated };

    const end = start + cfg.slotMinutes * 60_000;
    const day = localDate(start, hours.timezone);
    const agendas = await this.busy(caller, users, day, day);
    const free = agendas.find((agenda) => !agenda.busy.some((b) => b.start < end && b.end > start));
    if (!free) return { kind: 'taken' };
    if (Date.now() - args.startedAt > SOFT_DEADLINE_MS) return { kind: 'slow' };

    const owner = users.find((user) => user.id === free.ownerId)!;
    const from = localParts(start, hours.timezone);
    const to = localParts(end, hours.timezone);
    let created: unknown;
    try {
      ({ result: created } = await this.bitrix.call<number | string>(
        caller.installationId,
        'calendar.event.add',
        {
          type: 'user',
          ownerId: owner.id,
          auto_detect_section: 'Y',
          name: `Agendamento: ${client.name ?? 'cliente'}`.slice(0, TITLE_MAX),
          description: `Compromisso marcado pelo agente de IA.${subject ? `\nAssunto: ${subject}` : ''}`,
          from: `${from.data} ${from.hora}:00`,
          to: `${to.data} ${to.hora}:00`,
          timezone_from: hours.timezone,
          timezone_to: hours.timezone,
          attendees: [owner.id],
          accessibility: 'busy',
          importance: 'normal',
          is_meeting: 'N',
          crm_fields: [`${CRM_PREFIX[client.type]}${client.id}`],
        },
      ));
    } catch (error) {
      if (!(error instanceof BitrixError)) throw error;
      if (error.isScopeMissing) return { kind: 'scope' };
      if (error.code === 'ACCESS_DENIED') return { kind: 'denied', owner: owner.name };
      this.logger.warn({ err: error }, 'calendar.event.add falhou');
      return { kind: 'failed' };
    }
    if (!(Number(created) > 0)) return { kind: 'failed' };

    const body = {
      agendado: true,
      quando: spokenWhen(from.data, from.hora, currentYear(this.clock(), hours.timezone)),
      termina_as: spokenTime(to.hora),
      duracao_minutos: cfg.slotMinutes,
      fuso_horario: hours.timezone,
      com: owner.name,
      ...(subject ? { assunto: subject } : {}),
      mensagem:
        'Compromisso marcado no calendário. Confirme com o cliente a data, a hora e com quem será.',
    };
    await this.remember(key, body);
    return { kind: 'booked', result: result('ok', body, 1) };
  }

  /** Horário tomado: até 3 alternativas, as mais próximas do pedido. */
  private async alternatives(
    caller: CrmCaller,
    args: {
      cfg: CalendarConfigRow;
      hours: BusinessHours;
      now: number;
      users: AgendaUser[];
      start: number;
    },
  ): Promise<ToolResult> {
    const { cfg, hours, now, users, start } = args;
    const window = searchWindow(now, hours.timezone, cfg.maxDaysAhead);
    const agendas = await this.busy(caller, users, localDate(start, hours.timezone), window.last);
    const near = freeSlots({
      now,
      from: localDate(start, hours.timezone),
      hours,
      slotMinutes: cfg.slotMinutes,
      minNoticeMinutes: cfg.minNoticeMinutes,
      maxDaysAhead: cfg.maxDaysAhead,
      agendas,
      limit: 30,
    })
      .sort((a, b) => Math.abs(a.start - start) - Math.abs(b.start - start))
      .slice(0, MAX_ALTERNATIVES)
      .sort((a, b) => a.start - b.start);
    const names = new Map(users.map((user) => [user.id, user.name]));
    return result('not_found', {
      erro: 'Esse horário não está mais disponível.',
      fuso_horario: hours.timezone,
      duracao_minutos: cfg.slotMinutes,
      alternativas: near.map((slot) =>
        slotView(slot, hours.timezone, names, currentYear(now, hours.timezone)),
      ),
      ...(near.length === 0
        ? { mensagem: `Não há outro horário próximo disponível. ${TEAM_WILL_CONTACT}` }
        : { orientacao: (await this.guidance.current()).agenda }),
    });
  }

  /**
   * Usuários cuja agenda vale nesta chamada, conforme o modo (design D5), já filtrados pelos que
   * existem e estão ativos no portal. Na ordem configurada (a primeira agenda livre vence).
   */
  private async agendaUsers(
    caller: CrmCaller,
    cfg: CalendarConfigRow,
    client: Client | null,
  ): Promise<{ users: AgendaUser[] } | { result: ToolResult }> {
    let ids = cfg.userIds;
    if (cfg.mode === 'CLIENT_OWNER') {
      if (!client?.userId) return { result: NO_AGENDA };
      ids = [client.userId];
    }
    const { result: found } = await this.bitrix.call<PortalUser[]>(
      caller.installationId,
      'user.get',
      { FILTER: { ID: ids, ACTIVE: true } },
    );
    const active = new Map(
      (Array.isArray(found) ? found : []).map((user) => [
        Number(user.ID),
        [user.NAME, user.LAST_NAME].filter(Boolean).join(' ').trim() || 'a equipe',
      ]),
    );
    return {
      users: ids.filter((id) => active.has(id)).map((id) => ({ id, name: active.get(id)! })),
    };
  }

  /** Períodos ocupados de cada usuário entre os dias (inclusive), em UTC, só os que bloqueiam. */
  private async busy(
    caller: CrmCaller,
    users: AgendaUser[],
    firstDay: string,
    lastDay: string,
  ): Promise<AgendaBusy[]> {
    // A API recebe só datas: uma folga de um dia de cada lado cobre o deslocamento do fuso.
    const { result: byUserOrList } = await this.bitrix.call<
      Record<string, AccessibilityEvent[]> | AccessibilityEvent[]
    >(caller.installationId, 'calendar.accessibility.get', {
      users: users.map((user) => user.id),
      from: addDays(firstDay, -1),
      to: addDays(lastDay, 1),
    });
    const byUser = Array.isArray(byUserOrList) ? {} : (byUserOrList ?? {});
    return users.map((user) => ({
      ownerId: user.id,
      busy: (byUser[String(user.id)] ?? [])
        .filter((event) => BLOCKING.has(String(event.ACCESSIBILITY)))
        // `DATE_*_TS_UTC` não é UTC de verdade: ver `eventInterval`.
        .map((event) =>
          eventInterval({
            fromTs: event.DATE_FROM_TS_UTC,
            toTs: event.DATE_TO_TS_UTC,
            userOffset: event['~USER_OFFSET_FROM'],
            timezone: event.TZ_FROM,
            dateFrom: event.DATE_FROM,
            dateTo: event.DATE_TO,
            window: { first: addDays(firstDay, -1), last: addDays(lastDay, 1) },
          }),
        )
        .filter((interval): interval is Interval => interval !== null),
    }));
  }

  private async hoursOf(caller: CrmCaller): Promise<BusinessHours> {
    const agent = await this.agents.getById(caller.tenantId, caller.agentId);
    return agent.businessHours ?? DEFAULT_CALENDAR_HOURS;
  }

  /** Uma chamada ao Calendário funcionou: o aviso de escopo ausente some. */
  private async scopeWorked(caller: CrmCaller, cfg: CalendarConfigRow): Promise<void> {
    if (cfg.lastScopeErrorAt) {
      await this.config.clearScopeMissing(caller.tenantId, caller.agentId);
    }
  }

  /** Locks na ordem das chaves (sem impasse entre agendamentos que dividem usuários). */
  private async withLocks<T>(
    keys: string[],
    fn: () => Promise<T>,
  ): Promise<{ ran: true; result: T } | { ran: false }> {
    const [first, ...rest] = keys;
    if (first === undefined) return { ran: true, result: await fn() };
    const outcome = await this.lock.runExclusiveWaiting(first, LOCK_TTL_MS, LOCK_WAIT_MS, () =>
      this.withLocks(rest, fn),
    );
    return outcome.ran ? outcome.result : { ran: false };
  }

  private async alreadyBooked(key: string): Promise<ToolResult | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      return result('ok', JSON.parse(raw) as Record<string, unknown>, 1);
    } catch {
      return null;
    }
  }

  /** Guarda o resultado por 15 min (BOOKED_TTL_SECONDS): a mesma chamada de novo devolve o agendamento já feito. */
  private async remember(key: string, body: Record<string, unknown>): Promise<void> {
    await this.redis
      .set(key, JSON.stringify(body), 'EX', BOOKED_TTL_SECONDS)
      .catch((error: unknown) =>
        this.logger.warn({ err: error }, 'agendamento feito, mas a chave de repetição não gravou'),
      );
  }
}

/** Mesma chamada = mesmo cliente, no mesmo horário, para o mesmo agente. Sem dados pessoais na chave. */
function bookedKey(caller: CrmCaller, client: Client, start: number): string {
  const digest = createHash('sha256')
    .update(`${caller.tenantId}|${caller.agentId}|${client.type}:${client.id}|${start}`)
    .digest('hex');
  return `calendar:booked:${digest}`;
}

/**
 * Um horário livre para o agente. `quando` é o que ele diz ao cliente; `usar_ao_agendar` é o valor
 * interno que volta em `agendar_compromisso` (`inicio`) e que o cliente nunca deve ver.
 */
function slotView(slot: FreeSlot, timezone: string, names: Map<number, string>, year: number) {
  const start = localParts(slot.start, timezone);
  return {
    quando: spokenWhen(start.data, start.hora, year),
    termina_as: spokenTime(localParts(slot.end, timezone).hora),
    com: names.get(slot.ownerId),
    usar_ao_agendar: `${start.data} ${start.hora}`,
  };
}

/** Ano corrente no fuso da agenda: a data por extenso só cita o ano quando é outro. */
function currentYear(now: number, timezone: string): number {
  return Number(localDate(now, timezone).slice(0, 4));
}

function invalidSlot(
  violation: SlotViolation,
  rules: { now: number; hours: BusinessHours; minNoticeMinutes: number; maxDaysAhead: number },
  hours: BusinessHours,
): ToolResult {
  const window = searchWindow(rules.now, hours.timezone, rules.maxDaysAhead);
  const reason: Record<SlotViolation, string> = {
    past: 'Esse horário já passou.',
    window: 'Esse horário está depois do período em que há agenda.',
    grid: 'Esse horário está fora do expediente ou não é um dos horários oferecidos. Use "horarios_livres" e escolha um da lista.',
    notice: `Esse horário está antes da antecedência mínima de ${rules.minNoticeMinutes} minutos.`,
  };
  return result('not_found', {
    erro: reason[violation],
    periodo_permitido: { de: window.first, ate: window.last },
    fuso_horario: hours.timezone,
  });
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

/** `AAAA-MM-DD HH:mm` (ou com `T`) na hora de parede da agenda ⇒ instante; inválido ⇒ `null`. */
function parseLocalStart(value: unknown, timezone: string): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::00)?$/.exec(value.trim());
  if (!match) return null;
  const [, date, hour, minute] = match;
  if (parseDate(date) === 'invalid' || Number(hour) > 23 || Number(minute) > 59) return null;
  return zonedToEpoch(date!, Number(hour) * 60 + Number(minute), timezone);
}

/**
 * Assunto livre do agente: uma linha, sem controle, curto e sem `[ ] < >`: a descrição do evento
 * do Bitrix24 interpreta BBCode e HTML, e o texto vem do cliente final.
 */
function cleanSubject(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : char;
  })
    .join('')
    .replace(/[[\]<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SUBJECT_MAX);
  return text || null;
}

/** Instante em ISO com deslocamento (`2026-11-24T10:00:00+00:00`), formato que o filtro do Bitrix24 aceita. */
function isoWithOffset(instant: number): string {
  return new Date(instant).toISOString().replace(/\.\d{3}Z$/, '+00:00');
}
