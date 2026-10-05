/**
 * Prefixo legado `[<tenantCode>] <nome>` no nome dos agentes do GPTMaker (design D2). Agentes
 * novos vão com o nome puro; o prefixo ainda é lido para tirar dos agentes antigos e para sugerir
 * o dono de um órfão criado antes da mudança.
 */
const PREFIXED = /^\[([A-Za-z0-9-]{2,32})\] ([\s\S]*)$/;

/** Nome sem o prefixo legado; nomes sem prefixo voltam como estão. */
export function fromGptMakerName(gptmakerName: string): string {
  return PREFIXED.exec(gptmakerName)?.[2] ?? gptmakerName;
}

/** `tenantCode` do prefixo legado, ou `null`. */
export function tenantCodeFromGptMakerName(gptmakerName: string): string | null {
  return PREFIXED.exec(gptmakerName)?.[1] ?? null;
}
