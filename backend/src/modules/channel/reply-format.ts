import type { GptMakerConversationResponse } from '../gptmaker';

/** Limite do `message` no `imbot.v2.Chat.Message.send`; acima disso o Bitrix corta sem erro. */
export const BITRIX_MESSAGE_MAX = 20_000;

/**
 * Markdown que os modelos costumam devolver ⇒ BB-code do Bitrix (o chat não entende markdown):
 * `**negrito**`, `__negrito__`, `~~riscado~~`, `[texto](url)` e blocos de código. Itálico com um
 * asterisco fica como está: no WhatsApp `*x*` é negrito e o risco de errar é maior que o ganho.
 */
export function toBbCode(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '[CODE]$1[/CODE]')
    .replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, '[B]$1[/B]')
    .replace(/__(?=\S)([^_\n]+?)__/g, '[B]$1[/B]')
    .replace(/~~(?=\S)([^~\n]+?)~~/g, '[S]$1[/S]')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '[URL=$2]$1[/URL]');
}

/** Corta no limite do Bitrix sem partir a palavra, com reticências. */
export function fitMessage(text: string, max = BITRIX_MESSAGE_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${space > max * 0.8 ? cut.slice(0, space) : cut}…`;
}

type AttachBlock =
  { IMAGE: { LINK: string; NAME?: string } } | { FILE: { LINK: string; NAME: string } };

/** Nome do arquivo pela URL (último segmento do caminho), para o bloco `FILE`. */
export function fileNameOfUrl(url: string, fallback: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Campos do `imbot.v2.Chat.Message.send` para a resposta do GPTMaker: texto em BB-code e mídia
 * como `attach` pelo link do próprio GPTMaker (imagem ⇒ bloco `IMAGE`; áudio e documento ⇒
 * `FILE`, o Bitrix não tem bloco de áudio). Sem texto nem mídia ⇒ `null`.
 */
export function replyFields(
  reply: GptMakerConversationResponse,
): { message?: string; attach?: { BLOCKS: AttachBlock[] } } | null {
  const text = reply.message?.trim() ? fitMessage(toBbCode(reply.message.trim())) : undefined;
  const blocks: AttachBlock[] = [
    ...(reply.images ?? []).map((link) => ({ IMAGE: { LINK: link } })),
    ...(reply.audios ?? []).map((link, i) => ({
      FILE: { LINK: link, NAME: fileNameOfUrl(link, `audio-${i + 1}`) },
    })),
    ...(reply.documents ?? []).map((link, i) => ({
      FILE: { LINK: link, NAME: fileNameOfUrl(link, `documento-${i + 1}`) },
    })),
  ];
  if (!text && !blocks.length) return null;
  return {
    ...(text ? { message: text } : {}),
    ...(blocks.length ? { attach: { BLOCKS: blocks } } : {}),
  };
}
