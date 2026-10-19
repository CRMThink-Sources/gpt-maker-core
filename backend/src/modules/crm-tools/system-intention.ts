import { CRM_SYSTEM_INTENTION_NAME } from '@gptmaker/contracts';
import type { GptMakerMcpAdd, GptMakerWriteIntention } from '../gptmaker';

/** Rota que a intenção de sistema chama (o GPTMaker preenche `{{chat_id}}`). */
export const CLIENT_LOOKUP_PATH = '/gptmaker/crm/client';
export const MCP_PATH = '/mcp';

/** O que o agente lê para decidir usar a intenção (limite de 512 caracteres do GPTMaker). */
const WHEN_TO_USE =
  'Use para saber quem é o cliente desta conversa no CRM: nome, empresa, responsável e negócios ' +
  'em andamento (funil, etapa e valor). Use quando o cliente perguntar sobre o próprio cadastro, ' +
  'pedido, proposta, contrato ou atendimento, ou quando conhecer o cliente ajudar a responder. ' +
  'Não pergunte nada ao cliente antes de usar.';

/**
 * Intenção "Consultar cliente no CRM" (design S2): sem campos a coletar, corpo fixo com o chat e
 * a credencial do agente no cabeçalho. A resposta da API orienta o agente.
 */
export function systemIntention(publicUrl: string, token: string): GptMakerWriteIntention {
  return {
    description: CRM_SYSTEM_INTENTION_NAME,
    details: WHEN_TO_USE,
    manualOutput: false,
    type: 'WEBHOOK',
    httpMethod: 'POST',
    url: `${publicUrl}${CLIENT_LOOKUP_PATH}`,
    fields: [],
    headers: [{ name: 'Authorization', value: `Bearer ${token}` }],
    params: [],
    requestBody: JSON.stringify({ chat: '{{chat_id}}' }),
    autoGenerateParams: false,
    autoGenerateBody: false,
    preprocessingMessage: 'DISABLED',
    active: true,
  };
}

/** Conexão MCP do app no agente (design S4). */
export function mcpConnection(publicUrl: string, token: string): GptMakerMcpAdd {
  return {
    name: 'CRM Bitrix24',
    description: 'Consultas ao CRM do cliente: histórico de negócios e etapas dos funis',
    mcpUrl: `${publicUrl}${MCP_PATH}`,
    urlType: 'STREAMABLEHTTP',
    authType: 'HEADERS',
    headers: { Authorization: `Bearer ${token}` },
  };
}
