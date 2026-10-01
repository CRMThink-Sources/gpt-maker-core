import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../shared/redis/redis.module';
import {
  type GptMakerConversationRequest,
  type GptMakerConversationResponse,
  GptMakerClient,
  GptMakerError,
} from '../gptmaker';
import { type ChatAttachment, ChatMedia } from './chat-media';
import type { ForwardTarget } from './inbound-gate';
import { dialogKey, type InboundMessage } from './inbound-message';
import { messageIdOf } from './inbound-retry';
import { attachmentFileIds, hasUnknownAttachment } from './message-attachments';

/** Resposta guardada até ser publicada no Bitrix (9.6), para a retentativa não perguntar de novo. */
const REPLY_TTL_SECONDS = 24 * 60 * 60;

export function replyCacheKey(message: InboundMessage): string {
  return `channel:reply:${messageIdOf(message)}`;
}

/**
 * Erro do GPTMaker que nova tentativa não resolve: corpo recusado, agente inexistente, token
 * inválido ou resposta fora do contrato (o GPTMaker pode já ter respondido; repetir duplicaria).
 * Vai direto para a DLQ.
 */
export function isPermanentConversationError(error: unknown): boolean {
  return (
    error instanceof GptMakerError &&
    ['VALIDATION', 'NOT_FOUND', 'UNAUTHORIZED', 'INVALID_RESPONSE'].includes(error.kind)
  );
}

/**
 * Pergunta ao agente no GPTMaker (`POST /agent/{id}/conversation`) com `contextId =
 * tenantId:dialogId`, um contexto por diálogo do portal. Texto vai como `prompt`; o primeiro
 * anexo vai na variante do tipo (imagem, áudio, vídeo, documento) com o texto de legenda; os
 * demais anexos ficam de fora (uma mídia por chamada). Sem texto nem anexo utilizável ⇒ `null`.
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly gptmaker: GptMakerClient,
    private readonly media: ChatMedia,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async ask(
    message: InboundMessage,
    target: ForwardTarget,
  ): Promise<GptMakerConversationResponse | null> {
    const cached = await this.cachedReply(message);
    if (cached) return cached;

    const request = await this.buildRequest(message, target);
    if (!request) return null;
    const reply = await this.gptmaker.sendMessage(target.gptmakerAgentId, request);
    try {
      await this.redis.set(replyCacheKey(message), JSON.stringify(reply), 'EX', REPLY_TTL_SECONDS);
    } catch (error) {
      this.logger.warn({ err: error }, 'resposta do GPTMaker não guardada no Redis');
    }
    return reply;
  }

  private async buildRequest(
    message: InboundMessage,
    target: ForwardTarget,
  ): Promise<GptMakerConversationRequest | null> {
    const base = {
      contextId: dialogKey(message),
      ...(message.user.name ? { chatName: message.user.name } : {}),
    };
    const text = message.text.trim();

    const fileIds = attachmentFileIds(message.params);
    if (!fileIds.length && hasUnknownAttachment(message.params)) {
      this.logger.warn(
        { params: message.params },
        'anexo em formato desconhecido; só o texto segue',
      );
    }
    let media: ChatAttachment | null = null;
    if (fileIds.length) {
      if (fileIds.length > 1) {
        this.logger.warn({ fileIds }, 'mais de um anexo; só o primeiro vai ao GPTMaker');
      }
      media = await this.media.resolve({
        installationId: target.installationId,
        botId: message.botId,
        fileId: fileIds[0]!,
      });
    }

    switch (media?.kind) {
      case 'image':
        return { ...base, image: media.url, ...(text ? { prompt: text } : {}) };
      case 'audio':
        if (text)
          this.logger.warn('texto junto com áudio não vai ao GPTMaker (variante sem prompt)');
        return { ...base, audio: media.url };
      case 'video':
        return { ...base, video: media.url, ...(text ? { prompt: text } : {}) };
      case 'document':
        return { ...base, document: media.url, ...(text ? { prompt: text } : {}) };
      default:
        return text ? { ...base, prompt: text } : null;
    }
  }

  private async cachedReply(message: InboundMessage): Promise<GptMakerConversationResponse | null> {
    try {
      const raw = await this.redis.get(replyCacheKey(message));
      return raw ? (JSON.parse(raw) as GptMakerConversationResponse) : null;
    } catch (error) {
      this.logger.warn({ err: error }, 'resposta guardada indisponível no Redis');
      return null;
    }
  }
}
