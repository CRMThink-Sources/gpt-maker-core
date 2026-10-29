import type { CrmGuidanceKey } from '@gptmaker/contracts';

/**
 * Orientações padrão das respostas das ferramentas do CRM (spec agent-crm-tools). O backoffice
 * pode sobrescrever cada uma; sem edição, vale este texto.
 *
 * O escopo dos dados diz o que o agente tem e o que não tem do CRM: sem isso ele oferece
 * histórico de atividades e documentos, chama a ferramenta de novo e acaba pedindo desculpas
 * (visto em staging).
 */
export const CRM_GUIDANCE_DEFAULTS: Record<CrmGuidanceKey, string> = {
  cliente_identificado:
    'Use estes dados para responder ao cliente. Para negócios ganhos, perdidos ou todos os negócios, use a ferramenta negocios_do_cliente com a referência do cliente.',
  negocios_do_cliente:
    'Estes são todos os dados destes negócios: responda com eles, sem chamar a ferramenta de novo para buscar outros detalhes.',
  escopo_dados:
    'Dados disponíveis: o cadastro do cliente e os negócios dele, só com os campos liberados pela empresa (por exemplo funil, etapa, valor e datas). ' +
    'Dado que não veio não está liberado: não invente nem diga que vai buscar. ' +
    'Não há acesso a histórico de atividades, tarefas, e-mails, documentos nem anexos: não ofereça nem prometa esses dados; se o cliente pedir, diga que a equipe pode ajudar. ' +
    'Valor "não informado" significa que o negócio não tem valor cadastrado.',
  cliente_nao_identificado:
    'O cliente desta conversa não está identificado no CRM. Atenda normalmente, sem citar dados de cadastro.',
};

export type CrmGuidance = Record<CrmGuidanceKey, string>;

/** Orientação de uma resposta de sucesso: o texto próprio seguido do escopo dos dados. */
export function composeGuidance(
  guidance: CrmGuidance,
  key: 'cliente_identificado' | 'negocios_do_cliente',
): string {
  return `${guidance[key]} ${guidance.escopo_dados}`;
}
