import { Injectable, Logger } from '@nestjs/common';

/** Mudança já gravada num agente; o ouvinte relê o estado atual (não depende do payload). */
export interface AgentChange {
  agentId: string;
  tenantId: string;
  kind: 'created' | 'profile-updated' | 'removed';
}

export interface AgentChangeListener {
  /** Nome estável para logs (ex.: `channel`). */
  readonly name: string;
  onAgentChanged(change: AgentChange): Promise<void>;
}

/**
 * Reações de outros módulos a mudanças de agente (ex.: chatbot do Bitrix). Os módulos que
 * dependem de agentes se registram no `onModuleInit`; assim agentes não depende deles. Falha de
 * um ouvinte não desfaz a operação do agente: cada ouvinte tem a própria reconciliação.
 */
@Injectable()
export class AgentEvents {
  private readonly logger = new Logger(AgentEvents.name);
  private readonly listeners: AgentChangeListener[] = [];

  register(listener: AgentChangeListener): void {
    this.listeners.push(listener);
  }

  async emit(change: AgentChange): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener.onAgentChanged(change);
      } catch (error) {
        this.logger.warn(
          { listener: listener.name, ...change, err: error },
          'ouvinte de mudança de agente falhou; a reconciliação dele corrige',
        );
      }
    }
  }
}
