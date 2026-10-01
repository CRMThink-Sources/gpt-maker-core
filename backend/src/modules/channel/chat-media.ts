import { Injectable, Logger } from '@nestjs/common';
import { BitrixClient, BitrixError } from '../bitrix';
import { type MediaKind, mediaKindOf } from './message-attachments';

const PROBE_TIMEOUT_MS = 15_000;

export interface ChatAttachment {
  kind: MediaKind;
  /** Link de download do portal (token na própria URL) que o GPTMaker baixa. */
  url: string;
  fileName: string;
}

/** Falha do lado do Bitrix ou da rede: vale tentar de novo (retentativa da fila). */
export class MediaUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MediaUnavailableError';
  }
}

/**
 * Anexo que o cliente mandou no chat, para o GPTMaker baixar direto do portal. O link de
 * `imbot.v2.File.download` traz o token na URL, mas é de uso único (a documentação não garante
 * reuso) e o evento não diz o tipo do arquivo: um primeiro link serve só para ler o cabeçalho
 * (tipo e nome, sem baixar o corpo) e um segundo, novo, vai ao GPTMaker. Arquivo inexistente ou
 * recusado pelo portal ⇒ `null` (a mensagem segue só com o texto).
 */
@Injectable()
export class ChatMedia {
  private readonly logger = new Logger(ChatMedia.name);
  /** Troca nos testes. */
  fetchFn: typeof fetch = (input, init) => fetch(input, init);

  constructor(private readonly bitrix: BitrixClient) {}

  async resolve(input: {
    installationId: number;
    botId: number;
    fileId: number;
  }): Promise<ChatAttachment | null> {
    const probeUrl = await this.downloadUrl(input);
    if (!probeUrl) return null;

    let response: Response;
    try {
      response = await this.fetchFn(probeUrl, {
        headers: { Range: 'bytes=0-0' },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
    } catch (error) {
      throw new MediaUnavailableError('anexo inacessível no portal', { cause: error });
    }
    // Só o cabeçalho interessa; o portal pode ignorar o `Range` e mandar o arquivo inteiro.
    await response.body?.cancel().catch(() => undefined);
    if (response.status >= 500) {
      throw new MediaUnavailableError(`anexo no portal: HTTP ${response.status}`);
    }
    if (!response.ok) {
      this.logger.warn(
        { fileId: input.fileId, status: response.status },
        'anexo recusado pelo portal',
      );
      return null;
    }
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    const fileName =
      fileNameFrom(response.headers.get('content-disposition')) ?? `arquivo-${input.fileId}`;

    const url = await this.downloadUrl(input);
    if (!url) return null;
    return { kind: mediaKindOf(contentType, fileName), url, fileName };
  }

  private async downloadUrl(input: {
    installationId: number;
    botId: number;
    fileId: number;
  }): Promise<string | null> {
    try {
      const { result } = await this.bitrix.call<{ downloadUrl?: string }>(
        input.installationId,
        'imbot.v2.File.download',
        { botId: input.botId, fileId: input.fileId },
      );
      if (result?.downloadUrl) return result.downloadUrl;
      this.logger.warn({ fileId: input.fileId }, 'Bitrix não devolveu link do anexo');
      return null;
    } catch (error) {
      if (error instanceof BitrixError && !error.isTransient) {
        this.logger.warn({ fileId: input.fileId, err: error }, 'anexo recusado pelo Bitrix');
        return null;
      }
      throw new MediaUnavailableError('link do anexo indisponível', { cause: error });
    }
  }
}

/** Nome do arquivo em `Content-Disposition` (`filename*` UTF-8 tem prioridade). */
export function fileNameFrom(header: string | null): string | undefined {
  if (!header) return undefined;
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header)?.[1];
  if (extended) {
    try {
      return decodeURIComponent(extended.trim());
    } catch {
      // Codificação inválida: tenta o `filename` simples.
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(header)?.[1]?.trim();
  return plain || undefined;
}
