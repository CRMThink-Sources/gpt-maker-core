import { z } from 'zod';

/** Conversas de teste com o agente dentro do app (spec agent-test-chat). */
export const AGENT_TEST_MESSAGE_MAX = 4000;
export const AGENT_TEST_CONVERSATIONS_MAX = 50;

export const testClientTypeSchema = z.enum(['contact', 'lead', 'company']);
export type TestClientType = z.infer<typeof testClientTypeSchema>;

export const TEST_CLIENT_TYPE_LABELS: Record<TestClientType, string> = {
  contact: 'Contato',
  lead: 'Lead',
  company: 'Empresa',
};

/** Cliente do CRM simulado na conversa (o agente o vê como cliente da conversa). */
export const testClientSchema = z.object({
  type: testClientTypeSchema,
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(255),
});
export type TestClient = z.infer<typeof testClientSchema>;

export const newTestConversationSchema = z.object({
  client: testClientSchema.nullable().default(null),
});
export type NewTestConversationInput = z.input<typeof newTestConversationSchema>;

export const testMessageInputSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Escreva uma mensagem')
    .max(AGENT_TEST_MESSAGE_MAX, `Use até ${AGENT_TEST_MESSAGE_MAX} caracteres`),
});
export type TestMessageInput = z.input<typeof testMessageInputSchema>;

export interface TestMessageView {
  id: string;
  role: 'USER' | 'AGENT';
  text: string;
  /** `PENDING`: aguardando o agente; `FAILED`: o agente não respondeu (pode reenviar). */
  status: 'PENDING' | 'ANSWERED' | 'FAILED' | 'DELIVERED';
  createdAt: string;
}

export interface TestConversationSummary {
  id: string;
  client: TestClient | null;
  createdByName: string;
  /** Trecho da última mensagem (até 120 caracteres). */
  lastMessage: string | null;
  lastMessageAt: string;
  createdAt: string;
}

export interface TestConversationView extends TestConversationSummary {
  messages: TestMessageView[];
}

/** Resposta do envio: a mensagem do testador e a resposta do agente (quando houve). */
export interface TestExchangeView {
  message: TestMessageView;
  reply: TestMessageView | null;
}

/** Item da busca de clientes do CRM para simular. */
export interface CrmClientOption {
  type: TestClientType;
  id: number;
  name: string;
  company: string | null;
}
