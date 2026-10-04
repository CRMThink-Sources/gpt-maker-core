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
 * encaminhar), transfere ao operador livre da Linha Aberta e avisa o GPTMaker (`start-human`).
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
  }): Promise<HandoffOutcome> {
    const owner = await this.owner(input.tenantId, input.agentId);
    if (!owner) {
      this.logger.warn(input, 'transferência para humano de agente desconhecido; ignorada');
      return 'skipped';
    }
    const gptmakerChatId = gptmakerChatIdFor(owner.gptmakerAgentId, input.tenantId, input.dialogId);
    await this.human.set({
      tenantId: input.tenantId,
      agentId: input.agentId,
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
        input.userId
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
