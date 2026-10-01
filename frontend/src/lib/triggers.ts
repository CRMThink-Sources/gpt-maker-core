import type {
  AgentEventName,
  TemplateContext,
  TriggerActionInput,
  TriggerActionType,
  TriggerExecutionView,
} from '@gptmaker/contracts';
import type { Tone } from '@/components/ui';

/** Eventos do agente, na linguagem do usuário. */
export const AGENT_EVENTS: Record<AgentEventName, { label: string; description: string }> = {
  onFirstInteraction: {
    label: 'Primeiro atendimento do cliente',
    description: 'O cliente fala com o agente pela primeira vez.',
  },
  onStartInteraction: {
    label: 'Início de atendimento',
    description: 'Começa um atendimento (inclusive de quem já conversou antes).',
  },
  onNewMessage: {
    label: 'Nova mensagem',
    description: 'Cada mensagem do cliente ou do agente.',
  },
  onFinishInteraction: {
    label: 'Fim de atendimento',
    description: 'O atendimento é encerrado.',
  },
  onTransfer: {
    label: 'Transferência para humano',
    description: 'O agente passa o atendimento para um atendente.',
  },
  onLackKnowLedge: {
    label: 'Agente sem resposta',
    description: 'O agente não soube responder a uma pergunta.',
  },
  onCreateEvent: {
    label: 'Agendamento criado',
    description: 'O agente marcou um compromisso.',
  },
  onCancelEvent: {
    label: 'Agendamento cancelado',
    description: 'Um compromisso marcado pelo agente foi cancelado.',
  },
};

export const ACTION_TYPES: Record<TriggerActionType, { label: string; description: string }> = {
  CREATE_LEAD: { label: 'Criar lead', description: 'Novo lead no CRM.' },
  UPSERT_DEAL: {
    label: 'Criar ou atualizar negócio',
    description: 'Atualiza o negócio do diálogo ou cria um no funil escolhido.',
  },
  TIMELINE_COMMENT: {
    label: 'Comentário na timeline',
    description: 'Comentário no negócio, lead, contato ou empresa do diálogo.',
  },
  CREATE_TASK: { label: 'Criar tarefa', description: 'Tarefa para um usuário do portal.' },
  START_BIZPROC: {
    label: 'Iniciar processo de negócio',
    description: 'Roda um business process na entidade do diálogo.',
  },
  OUTBOUND_WEBHOOK: {
    label: 'Chamar URL externa',
    description: 'Envia o evento para outro sistema (POST assinado).',
  },
};

/** Configuração inicial de cada tipo ao adicionar uma ação. */
export function newAction(type: TriggerActionType): TriggerActionInput {
  switch (type) {
    case 'CREATE_LEAD':
      return {
        type,
        config: {
          fields: {
            TITLE: 'Lead de {{contact.name | "cliente"}}',
            NAME: '{{contact.name}}',
            PHONE: '{{contact.phone}}',
          },
        },
      };
    case 'UPSERT_DEAL':
      return {
        type,
        config: {
          categoryId: 0,
          // Escolhida na tela: o código da etapa muda de funil para funil.
          stageId: '',
          fields: { TITLE: 'Negócio de {{contact.name | "cliente"}}' },
        },
      };
    case 'TIMELINE_COMMENT':
      return { type, config: { text: 'Atendimento do agente {{agent.name}}: {{event.name}}' } };
    case 'CREATE_TASK':
      return {
        type,
        config: { title: 'Retornar para {{contact.name | "cliente"}}', responsibleId: 0 },
      };
    case 'START_BIZPROC':
      return { type, config: { templateId: 0, documentType: 'DEAL' } };
    case 'OUTBOUND_WEBHOOK':
      return { type, config: { url: '' } };
  }
}

export function executionStatus(status: TriggerExecutionView['status']): {
  label: string;
  tone: Tone;
} {
  if (status === 'SUCCESS') return { label: 'Executada', tone: 'green' };
  if (status === 'FAILED') return { label: 'Falhou', tone: 'amber' };
  return { label: 'Tentando de novo', tone: 'brand' };
}

/** Resumo do resultado da ação para o histórico. */
export function resultSummary(execution: TriggerExecutionView): string | null {
  const result = (execution.result ?? {}) as Record<string, unknown>;
  if (result.leadId) return `Lead #${String(result.leadId)}`;
  if (result.dealId) return `Negócio #${String(result.dealId)}${result.created ? ' (novo)' : ''}`;
  if (result.commentId)
    return `Comentário em ${String(result.entityType)} #${String(result.entityId)}`;
  if (result.taskId) return `Tarefa #${String(result.taskId)}`;
  if (result.workflowId) return `Processo ${String(result.workflowId)}`;
  if (result.status) return `HTTP ${String(result.status)}`;
  return null;
}

/** Contexto de exemplo para a prévia dos templates na tela. */
export const SAMPLE_CONTEXT: TemplateContext = {
  contact: { name: 'Maria Souza', phone: '+55 11 99999-0000' },
  message: { text: 'Quero um orçamento para 10 unidades', role: 'user' },
  agent: { id: 'agente', name: 'Seu agente' },
  event: { name: 'onFinishInteraction', date: new Date(0).toISOString() },
  dialog: { id: 'chat123' },
  interaction: { id: 'atendimento', protocol: '1005' },
  payload: { channel: 'API' },
};

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
