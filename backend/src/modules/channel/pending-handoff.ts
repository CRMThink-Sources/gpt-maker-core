import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../shared/redis/redis.module';

/** Transferência pedida por uma intenção, feita depois que a resposta do agente sai. */
export interface PendingHandoff {
  agentId: string;
  /** Usuário do Bitrix que recebe a conversa; ausente ⇒ operador livre da Linha Aberta. */
  userId?: number;
  /** Canal aberto que recebe a conversa (design D16). */
  lineId?: number;
  /**
   * Chat do GPTMaker recebido pela intenção. Depois de uma troca de agente (D17) é o do agente de
   * origem, e não o da intenção: o handoff usa este chat e o agente dono dele.
   */
  gptmakerChatId?: string;
}

/** A conversa em curso responde em segundos; depois disso o pedido perde o sentido. */
const TTL_SECONDS = 5 * 60;

const keyOf = (tenantId: string, dialogId: string) =>
  `channel:handoff-after-reply:${tenantId}:${dialogId}`;

/**
 * Transferências agendadas por intenções (spec agent-intentions). A intenção roda enquanto o
 * GPTMaker ainda está montando a resposta; transferir na hora cortaria a mensagem de despedida do
 * agente. Por isso ela só registra aqui, e o canal transfere logo depois de publicar a resposta.
 */
@Injectable()
export class PendingHandoffs {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async schedule(tenantId: string, dialogId: string, handoff: PendingHandoff): Promise<void> {
    await this.redis.set(keyOf(tenantId, dialogId), JSON.stringify(handoff), 'EX', TTL_SECONDS);
  }

  async peek(tenantId: string, dialogId: string): Promise<PendingHandoff | null> {
    const raw = await this.redis.get(keyOf(tenantId, dialogId));
    return raw ? (JSON.parse(raw) as PendingHandoff) : null;
  }

  async clear(tenantId: string, dialogId: string): Promise<void> {
    await this.redis.del(keyOf(tenantId, dialogId));
  }
}
