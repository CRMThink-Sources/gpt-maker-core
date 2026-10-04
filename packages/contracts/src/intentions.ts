import { z } from 'zod';
import { templateFieldNames } from './templates';
import {
  type IntentionActionInput,
  intentionActionInputSchema,
  TRIGGER_MAX_ACTIONS,
} from './triggers';

/** Tipos dos campos que o agente coleta na conversa (os do GPTMaker). */
export const intentionFieldTypeSchema = z.enum([
  'STRING',
  'NUMBER',
  'BOOLEAN',
  'DATE',
  'DATE_TIME',
  'URL',
]);
export type IntentionFieldType = z.infer<typeof intentionFieldTypeSchema>;

export const INTENTION_MAX_FIELDS = 20;
export const INTENTION_MAX_PAIRS = 20;

/** Campo citado na URL, nos parâmetros, nos cabeçalhos e no corpo: `{{nome_json}}`. */
export const INTENTION_PLACEHOLDER = /\{\{\s*([^{}\s]+)\s*\}\}/g;

/**
 * Nome JSON do campo a partir do nome dado pelo cliente (`Número do pedido` ⇒
 * `numero_do_pedido`): é como o campo é citado (`{{numero_do_pedido}}`).
 */
export function intentionJsonName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Campos citados num texto (`{{campo}}`), na ordem e sem repetir. */
export function intentionPlaceholders(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set([...text.matchAll(INTENTION_PLACEHOLDER)].map((match) => match[1]!))];
}

const httpUrl = z.url({ protocol: /^https?$/ });

const fieldSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do campo').max(60),
  description: z.string().trim().min(1, 'Explique o campo para o agente').max(500),
  type: intentionFieldTypeSchema,
  required: z.boolean(),
});

/** Todos os textos de uma ação (para achar os `{{fields.x}}` citados). */
function actionTexts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(actionTexts);
  if (value && typeof value === 'object') return Object.values(value).flatMap(actionTexts);
  return [];
}

const pairName = z.string().trim().min(1, 'Informe o nome').max(200);

const headerSchema = z.object({
  name: pairName,
  /** `null` na edição: mantém o valor gravado (não volta ao navegador). */
  value: z.string().max(4000).nullable(),
});

const paramSchema = z.object({ name: pairName, value: z.string().max(4000) });

/**
 * Intenção do agente (spec agent-intentions; tarefa 17): o agente coleta os campos na conversa,
 * chama a URL e responde com base no retorno da API ou numa instrução própria.
 */
export const intentionInputSchema = z
  .object({
    /** Nome curto que identifica a intenção (`description` no GPTMaker). Único por agente. */
    /** `WEBHOOK`: chama a API do cliente; `BITRIX`: o app executa ações no portal. */
    kind: z.enum(['WEBHOOK', 'BITRIX']).default('WEBHOOK'),
    name: z.string().trim().min(1, 'Dê um nome à intenção').max(255),
    /** Quando o agente deve usar a intenção (`details`). */
    whenToUse: z.string().trim().min(1, 'Explique quando usar').max(2000),
    fields: z.array(fieldSchema).max(INTENTION_MAX_FIELDS),
    httpMethod: z.enum(['GET', 'POST']),
    /** Só na intenção `WEBHOOK` (na `BITRIX` a URL é do app). */
    url: z.string().trim().max(2000).default(''),
    headers: z.array(headerSchema).max(INTENTION_MAX_PAIRS).default([]),
    params: z.array(paramSchema).max(INTENTION_MAX_PAIRS).default([]),
    /** Corpo do `POST` (JSON), quando não gerado pelo agente. */
    body: z.string().max(20_000).nullable().default(null),
    /** Ações no portal (intenção `BITRIX`), executadas em ordem; textos aceitam `{{fields.x}}`. */
    actions: z.array(intentionActionInputSchema).max(TRIGGER_MAX_ACTIONS).default([]),
    autoGenerateParams: z.boolean(),
    autoGenerateBody: z.boolean(),
    /** `API`: o agente responde a partir do retorno; `INSTRUCTIONS`: segue `instructions`. */
    responseMode: z.enum(['API', 'INSTRUCTIONS']),
    instructions: z.string().trim().max(5000).nullable(),
    active: z.boolean(),
  })
  .superRefine((input, ctx) => {
    const names = input.fields.map((field) => intentionJsonName(field.name));
    names.forEach((jsonName, index) => {
      if (!jsonName) {
        ctx.addIssue({
          code: 'custom',
          path: ['fields', index, 'name'],
          message: 'Use letras ou números no nome do campo',
        });
      } else if (names.indexOf(jsonName) !== index) {
        ctx.addIssue({
          code: 'custom',
          path: ['fields', index, 'name'],
          message: 'Já existe um campo com esse nome',
        });
      }
    });

    const known = new Set(names);
    if (input.kind === 'BITRIX') {
      if (!input.actions.length) {
        ctx.addIssue({ code: 'custom', path: ['actions'], message: 'Inclua ao menos uma ação' });
      }
      input.actions.forEach((action, index) => {
        const unknown = [...new Set(actionTexts(action.config).flatMap(templateFieldNames))].filter(
          (name) => !known.has(name),
        );
        if (unknown.length) {
          ctx.addIssue({
            code: 'custom',
            path: ['actions', index],
            message: `Campo não cadastrado: ${unknown.map((name) => `{{fields.${name}}}`).join(', ')}`,
          });
        }
      });
    } else {
      const check = (text: string | null, path: (string | number)[]) => {
        const unknown = intentionPlaceholders(text).filter((name) => !known.has(name));
        if (unknown.length) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: `Campo não cadastrado: ${unknown.map((name) => `{{${name}}}`).join(', ')}`,
          });
        }
      };
      check(input.url, ['url']);
      input.params.forEach((param, index) => check(param.value, ['params', index, 'value']));
      input.headers.forEach((header, index) => check(header.value, ['headers', index, 'value']));
      check(input.body, ['body']);

      // Com os campos trocados por um valor qualquer, a URL tem de ser http(s) válida.
      if (!input.url) {
        ctx.addIssue({ code: 'custom', path: ['url'], message: 'Informe a URL' });
      } else if (!httpUrl.safeParse(input.url.replace(INTENTION_PLACEHOLDER, 'x')).success) {
        ctx.addIssue({ code: 'custom', path: ['url'], message: 'Informe uma URL http ou https' });
      }

      if (input.httpMethod === 'POST' && !input.autoGenerateBody && input.body?.trim()) {
        try {
          // Campo como número (`{"qtd": {{qtd}}}`) também é JSON válido depois de preenchido.
          JSON.parse(input.body.replace(INTENTION_PLACEHOLDER, '0'));
        } catch {
          ctx.addIssue({
            code: 'custom',
            path: ['body'],
            message: 'O corpo precisa ser um JSON válido',
          });
        }
      }
    }
    if (input.responseMode === 'INSTRUCTIONS' && !input.instructions?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['instructions'],
        message: 'Escreva a instrução de resposta',
      });
    }
  });
export type IntentionInput = z.input<typeof intentionInputSchema>;

export interface IntentionView {
  id: string;
  kind: 'WEBHOOK' | 'BITRIX';
  /** Ações no portal (intenção `BITRIX`). */
  actions: IntentionActionInput[];
  name: string;
  whenToUse: string;
  fields: Array<{
    name: string;
    jsonName: string;
    description: string;
    type: IntentionFieldType;
    required: boolean;
  }>;
  httpMethod: 'GET' | 'POST';
  url: string;
  /** Valor nunca volta: só se há um gravado. */
  headers: Array<{ name: string; hasValue: boolean }>;
  params: Array<{ name: string; value: string }>;
  body: string | null;
  autoGenerateParams: boolean;
  autoGenerateBody: boolean;
  responseMode: 'API' | 'INSTRUCTIONS';
  instructions: string | null;
  active: boolean;
  /** `false`: criada no GPTMaker, mas o id ainda não foi localizado (a próxima leitura tenta). */
  synced: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IntentionExecutionView {
  id: string;
  createdAt: string;
  status: 'SUCCESS' | 'FAILED' | 'REJECTED';
  /** Campos recebidos do agente. */
  fields: Record<string, string>;
  dialogId: string | null;
  /** O que foi devolvido ao agente. */
  message: string;
  results: Array<{ type: string; ok: boolean; result?: Record<string, unknown>; error?: string }>;
  durationMs: number;
}
