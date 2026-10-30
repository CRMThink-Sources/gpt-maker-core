import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { agent, dialogState, tenant } from '../../shared/database/schema/index';
import { BitrixClient, BitrixError } from '../bitrix';
import { GptMakerClient, GptMakerError } from '../gptmaker';
import { HumanAttendance } from './human-attendance';
import { dialogKey } from './inbound-message';

/**
 * Id do chat no GPTMaker de uma conversa pela API: o `contextId` que o app manda (9.5) com o
 * prefixo `public-api-<agentId>-` (observado; `docs/gptmaker-api.md` §7).
 */
export function gptmakerChatIdFor(
  gptmakerAgentId: string,
  tenantId: string,
  dialogId: string,
): string {
  return `public-api-${gptmakerAgentId}-${dialogKey({ tenantId, dialogId })}`;
}

/** `chat9498` ⇒ 9498 (diálogos de Linha Aberta são sempre de chat). */
export function chatIdOf(dialogId: string): number | null {
  const match = /^chat(\d+)$/.exec(dialogId);
  return match ? Number(match[1]) : null;
}

export type HandoffOutcome = 'started' | 'stopped' | 'skipped';

/**
 * Atendimento humano num diálogo (spec bitrix-chatbot-channel: transferência para humano).
 * `start` (o GPTMaker pediu, `onTransfer`): marca o diálogo como humano (o worker para de
 * encaminhar), transfere ao operador livre da Linha Aberta e, no GPTMaker, marca a transferência
 * (`start-human`) e encerra o atendimento do agente (`stop-human`).
 * `stop` (o atendimento humano terminou): desmarca e avisa o GPTMaker (`stop-human`), e o agente
 * volta a responder. Cada passo é idempotente; recusas definitivas (diálogo já com operador, chat
 * inexistente no GPTMaker) só vão para o log.
 */
@Injectable()
export class HumanHandoff {
  private readonly logger = new Logger(HumanHandoff.name);

  constructor(
    private readonly human: HumanAttendance,
    private readonly bitrix: BitrixClient,
    private readonly gptmaker: GptMakerClient,
    @Inject(DB) private readonly db: Database,
  ) {}

  async start(input: {
    tenantId: string;
    agentId: string;
    dialogId: string;
    /** Usuário do Bitrix que recebe a conversa (intenção); ausente ⇒ operador livre da linha. */
    userId?: number;
    /** Canal aberto que recebe a conversa (intenção, design D16). */
    lineId?: number;
    /** Chat recebido pela intenção; o dono dele é o agente do diálogo (design D17). */
    gptmakerChatId?: string;
  }): Promise<HandoffOutcome> {
    // Depois de uma troca de agente no GPTMaker, a intenção é do destino, mas o chat e o diálogo
    // continuam do agente de origem: é ele que fica no estado do diálogo.
    const origin = input.gptmakerChatId
      ? await this.chatOwner(input.tenantId, input.gptmakerChatId)
      : null;
    const agentId = origin ?? input.agentId;
    const owner = await this.owner(input.tenantId, agentId);
    if (!owner) {
      this.logger.warn(input, 'transferência para humano de agente desconhecido; ignorada');
      return 'skipped';
    }
    // Só o chat de um agente reconhecido: formato inesperado volta ao chat calculado.
    const gptmakerChatId =
      origin && input.gptmakerChatId
        ? input.gptmakerChatId
        : gptmakerChatIdFor(owner.gptmakerAgentId, input.tenantId, input.dialogId);
    await this.human.set({
      tenantId: input.tenantId,
      agentId,
      dialogId: input.dialogId,
      gptmakerChatId,
      active: true,
    });

    const chatId = chatIdOf(input.dialogId);
    if (chatId === null) {
      this.logger.warn(
        { dialogId: input.dialogId },
        'diálogo sem chat da Linha Aberta; sem transferência',
      );
    } else {
      await this.tolerant('transferência ao operador', () =>
        input.lineId
          ? this.bitrix.call(owner.installationId, 'imopenlines.bot.session.transfer', {
              CHAT_ID: chatId,
              QUEUE_ID: input.lineId,
              LEAVE: 'N',
            })
          : input.userId
            ? this.bitrix.call(owner.installationId, 'imopenlines.bot.session.transfer', {
                CHAT_ID: chatId,
                USER_ID: input.userId,
                LEAVE: 'N',
              })
            : this.bitrix.call(owner.installationId, 'imopenlines.bot.session.operator', {
                CHAT_ID: chatId,
              }),
      );
    }
    await this.tolerant('start-human no GPTMaker', () => this.gptmaker.startHuman(gptmakerChatId));
    // O atendimento do agente acaba na transferência: `stop-human` o deixa RESOLVED no GPTMaker
    // (com o `transferAt` do passo anterior), e as métricas de tempo de atendimento fecham. O
    // agente não volta a responder: enquanto o diálogo está com humano, o app não repassa as
    // mensagens (docs/gptmaker-api.md §7).
    await this.tolerant('encerrar o atendimento no GPTMaker', () =>
      this.gptmaker.stopHuman(gptmakerChatId),
    );
    this.logger.log({ dialogId: input.dialogId }, 'diálogo transferido para atendimento humano');
    return 'started';
  }

  /** Só age se o diálogo estava em atendimento humano; repetir não chama o GPTMaker de novo. */
  async stop(input: { tenantId: string; dialogId: string }): Promise<HandoffOutcome> {
    const [state] = await this.db
      .select({
        agentId: dialogState.agentId,
        gptmakerChatId: dialogState.gptmakerChatId,
        humanActive: dialogState.humanActive,
      })
      .from(dialogState)
      .where(
        and(eq(dialogState.tenantId, input.tenantId), eq(dialogState.dialogId, input.dialogId)),
      );
    if (!state?.humanActive) return 'skipped';

    const owner = await this.owner(input.tenantId, state.agentId);
    const gptmakerChatId =
      state.gptmakerChatId ??
      (owner ? gptmakerChatIdFor(owner.gptmakerAgentId, input.tenantId, input.dialogId) : null);
    await this.human.set({
      tenantId: input.tenantId,
      dialogId: input.dialogId,
      agentId: state.agentId,
      gptmakerChatId,
      active: false,
    });
    if (gptmakerChatId) {
      await this.tolerant('stop-human no GPTMaker', () => this.gptmaker.stopHuman(gptmakerChatId));
    }
    this.logger.log(
      { dialogId: input.dialogId },
      'atendimento humano encerrado; agente volta a responder',
    );
    return 'stopped';
  }

  /** Agente do portal dono de um chat `public-api-<agente no GPTMaker>-…`. */
  private async chatOwner(tenantId: string, gptmakerChatId: string): Promise<string | null> {
    const match = /^public-api-(.+)-[0-9a-f-]{36}:/.exec(gptmakerChatId);
    if (!match) return null;
    const [row] = await this.db
      .select({ id: agent.id })
      .from(agent)
      .where(and(eq(agent.tenantId, tenantId), eq(agent.gptmakerAgentId, match[1]!)));
    return row?.id ?? null;
  }

  private async owner(
    tenantId: string,
    agentId: string,
  ): Promise<{ gptmakerAgentId: string; installationId: number } | null> {
    const [row] = await this.db
      .select({ gptmakerAgentId: agent.gptmakerAgentId, installationId: tenant.installationId })
      .from(agent)
      .innerJoin(tenant, eq(tenant.id, agent.tenantId))
      .where(and(eq(agent.id, agentId), eq(agent.tenantId, tenantId)));
    return row
      ? { gptmakerAgentId: row.gptmakerAgentId, installationId: Number(row.installationId) }
      : null;
  }

  /** Falha transitória sobe (a mensagem vai para a DLQ da fila); recusa definitiva só no log. */
  private async tolerant(step: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      const definitive =
        (error instanceof BitrixError && !error.isTransient) ||
        (error instanceof GptMakerError && !error.isTransient && error.kind !== 'RATE_LIMITED');
      if (!definitive) throw error;
      this.logger.warn({ err: error }, `${step} recusada`);
    }
  }
}
