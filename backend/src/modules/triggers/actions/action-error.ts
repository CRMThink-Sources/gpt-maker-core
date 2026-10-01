/**
 * Falha ao executar uma ação de gatilho. `transient` decide a retentativa (10.7): falha do lado
 * do Bitrix, do destino ou da rede tenta de novo; configuração errada ou recusa definitiva não.
 */
export class ActionError extends Error {
  readonly transient: boolean;

  constructor(message: string, options: { transient: boolean; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = 'ActionError';
    this.transient = options.transient;
  }
}
