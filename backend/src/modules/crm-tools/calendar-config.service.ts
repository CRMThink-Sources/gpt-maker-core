import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type CalendarConfig,
  type CalendarConfigInput,
  calendarConfigInputSchema,
  type CalendarConfigView,
} from '@gptmaker/contracts';
import { DomainError } from '../../shared/http/api-exception.filter';
import { AgentRepository } from '../agents';
import { BitrixClient, BitrixError } from '../bitrix';
import { type CalendarConfigRow, CalendarConfigRepository } from './calendar-config.repository';

/** Dados do portal do tenant da sessão, usados para conferir os usuários escolhidos. */
export interface CalendarPortal {
  tenantId: string;
  installationId: number;
}

const crmRequired = () =>
  new DomainError(
    'CALENDAR_CRM_REQUIRED',
    'A agenda só pode ser configurada com o acesso ao CRM do agente ativo',
    HttpStatus.CONFLICT,
  );

/**
 * Agenda do agente no Calendário do Bitrix24 (spec agent-calendar-scheduling, "Configurar a agenda
 * do agente"): ler, salvar e remover a configuração, sempre no tenant da sessão. Agente de outro
 * tenant responde 404 como nos demais recursos.
 */
@Injectable()
export class CalendarConfigService {
  constructor(
    private readonly agents: AgentRepository,
    private readonly repository: CalendarConfigRepository,
    private readonly bitrix: BitrixClient,
  ) {}

  async view(tenantId: string, agentId: string): Promise<CalendarConfigView> {
    const owner = await this.agents.getById(tenantId, agentId);
    return this.toView(tenantId, owner.id, await this.repository.find(tenantId, owner.id));
  }

  async save(
    portal: CalendarPortal,
    agentId: string,
    raw: CalendarConfigInput,
  ): Promise<CalendarConfigView> {
    const input = calendarConfigInputSchema.parse(raw);
    const owner = await this.agents.getById(portal.tenantId, agentId);
    if (!(await this.repository.crmConnected(portal.tenantId, owner.id))) throw crmRequired();
    await this.assertUsersActive(portal, input);
    const row = await this.repository.upsert(portal.tenantId, owner.id, {
      mode: input.mode,
      userIds: input.userIds,
      slotMinutes: input.slotMinutes,
      minNoticeMinutes: input.minNoticeMinutes,
      maxDaysAhead: input.maxDaysAhead,
    });
    // Sem linha de volta = a agenda é de outro tenant: mesma resposta de agente inexistente.
    if (!row) {
      throw new DomainError('AGENT_NOT_FOUND', 'Agente não encontrado', HttpStatus.NOT_FOUND);
    }
    return this.toView(portal.tenantId, owner.id, row);
  }

  async remove(tenantId: string, agentId: string): Promise<CalendarConfigView> {
    const owner = await this.agents.getById(tenantId, agentId);
    await this.repository.remove(tenantId, owner.id);
    return this.toView(tenantId, owner.id, undefined);
  }

  /**
   * Uma ferramenta de agenda foi recusada por falta do escopo: o painel pede a reautorização.
   * Quem chama (ferramentas MCP) deve passar o `tenantId` e o `agentId` da credencial já
   * verificada (`CrmCaller`), nunca valores vindos do modelo ou do corpo da chamada.
   */
  markScopeMissing(tenantId: string, agentId: string): Promise<void> {
    return this.repository.setScopeError(tenantId, agentId, new Date());
  }

  /** Uma chamada ao Calendário funcionou: o aviso de escopo some. */
  clearScopeMissing(tenantId: string, agentId: string): Promise<void> {
    return this.repository.setScopeError(tenantId, agentId, null);
  }

  /** Os usuários precisam existir e estar ativos no portal do tenant. */
  private async assertUsersActive(portal: CalendarPortal, input: CalendarConfig): Promise<void> {
    if (input.userIds.length === 0) return;
    let active: Set<number>;
    try {
      const { result } = await this.bitrix.call<Array<{ ID: string | number }>>(
        portal.installationId,
        'user.get',
        { FILTER: { ID: input.userIds, ACTIVE: true } },
      );
      active = new Set((Array.isArray(result) ? result : []).map((user) => Number(user.ID)));
    } catch (error) {
      if (!(error instanceof BitrixError)) throw error;
      throw new DomainError(
        'CALENDAR_PORTAL_UNAVAILABLE',
        'Não foi possível conferir os usuários no Bitrix24; tente de novo em instantes',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const invalid = input.userIds.filter((id) => !active.has(id));
    if (invalid.length > 0) {
      throw new DomainError(
        'CALENDAR_USER_INVALID',
        'Há usuários que não existem no portal ou estão inativos',
        HttpStatus.UNPROCESSABLE_ENTITY,
        { userIds: invalid },
      );
    }
  }

  private async toView(
    tenantId: string,
    agentId: string,
    row: CalendarConfigRow | undefined,
  ): Promise<CalendarConfigView> {
    return {
      config: row
        ? {
            mode: row.mode,
            userIds: row.userIds,
            slotMinutes: row.slotMinutes,
            minNoticeMinutes: row.minNoticeMinutes,
            maxDaysAhead: row.maxDaysAhead,
          }
        : null,
      crmConnected: await this.repository.crmConnected(tenantId, agentId),
      // "Recente" = ainda não resolvido: a próxima chamada que funcionar limpa o aviso.
      scopeMissing: row?.lastScopeErrorAt != null,
    };
  }
}
