/**
 * Convenção de nomes no workspace compartilhado (spec gptmaker-workspace): o GPTMaker guarda
 * `[<tenantCode>] <nome>`, para operadores identificarem o dono no painel e para recuperar
 * vínculos de agentes órfãos; o cliente só vê `<nome>`.
 */
const PREFIXED = /^\[([A-Za-z0-9-]{2,32})\] ([\s\S]*)$/;

export function toGptMakerName(tenantCode: string, displayName: string): string {
  if (!/^[A-Za-z0-9-]{2,32}$/.test(tenantCode)) {
    throw new Error(`tenantCode inválido: ${tenantCode}`);
  }
  const name = displayName.trim();
  if (!name) throw new Error('Nome do agente vazio');
  return `[${tenantCode}] ${name}`;
}

/** Nome exibido ao cliente; nomes fora da convenção (ex.: criados à mão no painel) voltam como estão. */
export function fromGptMakerName(gptmakerName: string): string {
  return PREFIXED.exec(gptmakerName)?.[2] ?? gptmakerName;
}

/** `tenantCode` do prefixo, usado para sugerir o dono de um agente órfão. */
export function tenantCodeFromGptMakerName(gptmakerName: string): string | null {
  return PREFIXED.exec(gptmakerName)?.[1] ?? null;
}
