import { z } from 'zod';
import type { TemplateCheck } from './agent-function-check';
import type { CompiledAgent } from './agent-function-compiler';
import type { DiffLine } from './agent-function-plan';
import {
  blockCodeSchema,
  type FunctionBlockContent,
  type FunctionField,
  functionBlockContentSchema,
  functionCodeSchema,
  type FunctionTemplateContent,
  type FunctionTemplateDraft,
  functionTemplateDraftSchema,
} from './agent-functions';

/** Backoffice das funções (spec admin-backoffice, "Gestão de templates de função"). */

const name = z.string().trim().min(1).max(100);
const description = z.string().trim().min(1).max(500);

/** Nova função: rascunho próprio ou copiado de outra função (`copyFrom`, design D12). */
export const createFunctionTemplateSchema = z
  .object({
    code: functionCodeSchema,
    name,
    description,
    draft: functionTemplateDraftSchema.optional(),
    copyFrom: functionCodeSchema.optional(),
  })
  .refine((input) => (input.draft === undefined) !== (input.copyFrom === undefined), {
    message: 'informe o rascunho ou a função de origem',
    path: ['draft'],
  });
export type CreateFunctionTemplateInput = z.input<typeof createFunctionTemplateSchema>;

export const saveFunctionTemplateSchema = z.object({
  name: name.optional(),
  description: description.optional(),
  draft: functionTemplateDraftSchema,
});
export type SaveFunctionTemplateInput = z.input<typeof saveFunctionTemplateSchema>;

export const createFunctionBlockSchema = z.object({
  code: blockCodeSchema,
  name,
  draft: functionBlockContentSchema,
});
export type CreateFunctionBlockInput = z.input<typeof createFunctionBlockSchema>;

export const saveFunctionBlockSchema = z.object({
  name: name.optional(),
  draft: functionBlockContentSchema,
});
export type SaveFunctionBlockInput = z.input<typeof saveFunctionBlockSchema>;

/** Prévia do rascunho com respostas de exemplo (spec agent-function-templates, "Teste em sandbox"). */
export const previewFunctionDraftSchema = z.object({
  answers: z.record(z.string(), z.unknown()).default({}),
  agentName: z.string().trim().min(1).max(100).default('Agente'),
  mode: z.enum(['SIMPLE', 'ADVANCED']).default('SIMPLE'),
  additionalInstructions: z.string().max(1000).nullable().default(null),
});
export type PreviewFunctionDraftInput = z.input<typeof previewFunctionDraftSchema>;

/** Portais em que a função aparece na criação de agentes; lista vazia = todos os portais. */
export const setFunctionTenantsSchema = z.object({
  tenantIds: z.array(z.uuid()).max(500),
});
export type SetFunctionTenantsInput = z.input<typeof setFunctionTenantsSchema>;

export interface AdminFunctionTemplateSummary {
  code: string;
  name: string;
  description: string;
  latestVersion: number | null;
  /** Inativa: fora da criação de agentes; os agentes existentes seguem normais. */
  active: boolean;
  /**
   * Portais em que a função aparece na criação de agentes; vazio = todos. Fora deles a função
   * some da criação, mas os agentes que já a usam seguem normais.
   */
  tenants: Array<{ id: string; domain: string }>;
  /** Agentes (não removidos) com esta função, em qualquer versão. */
  agents: number;
  updatedAt: string;
}

export interface AdminFunctionVersionSummary {
  version: number;
  publishedAt: string;
  /** Nulo na versão do seed. */
  publishedBy: string | null;
  /** Agentes publicados nesta versão. */
  agents: number;
}

export interface AdminFunctionTemplateView extends AdminFunctionTemplateSummary {
  draft: FunctionTemplateDraft;
  versions: AdminFunctionVersionSummary[];
  /**
   * Campos que já saíram em alguma versão publicada, com o tipo e os valores das opções: as
   * respostas dos agentes estão guardadas por eles, então o editor não deixa renomeá-los.
   */
  /** `multiple` só em `BITRIX_USER`: travado depois de publicado, como o tipo (D15). */
  published: Record<string, { kind: FunctionField['kind']; options: string[]; multiple?: boolean }>;
  /** Chaves de intenção já publicadas: ligam a ação dos agentes, o editor não as renomeia. */
  publishedIntentions: string[];
}

export interface AdminFunctionVersionView extends AdminFunctionVersionSummary {
  content: FunctionTemplateContent;
}

export interface FunctionVersionDiff {
  from: number;
  to: number;
  behavior: DiffLine[];
  /** Conteúdo inteiro (JSON com chaves ordenadas), linha a linha. */
  content: DiffLine[];
}

export interface AdminFunctionBlockView {
  code: string;
  name: string;
  draft: FunctionBlockContent;
  /** Nulo enquanto o bloco nunca foi publicado. */
  content: FunctionBlockContent | null;
  publishedAt: string | null;
  /** Templates cujo rascunho inclui o bloco. */
  usedBy: string[];
}

/** Resultado da prévia do rascunho: o compilado com as respostas e a checagem de publicação. */
export interface FunctionDraftPreview {
  /** Conteúdo do rascunho com os blocos publicados expandidos: o formulário da prévia. */
  content: FunctionTemplateContent;
  compiled: CompiledAgent;
  check: TemplateCheck;
  /** Erros de expansão dos blocos (bloco inexistente ou não incluído). */
  blockErrors: string[];
  /** Problemas das respostas de exemplo. */
  answerIssues: Array<{ field: string; message: string }>;
}
