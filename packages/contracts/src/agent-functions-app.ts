import { z } from 'zod';
import type { AnswerIssue, FunctionAnswers } from './agent-function-answers';
import type { CompiledAgent, FunctionMode } from './agent-function-compiler';
import type { PublicationPlan } from './agent-function-plan';
import { FUNCTION_BEHAVIOR_MAX, type FunctionTemplateContent } from './agent-functions';

/** Configuração da função pelo cliente (spec agent-function-configuration). */

const answers = z.record(z.string(), z.unknown());

/** Prévia antes de criar o agente: sem agente, o plano é contra o estado vazio (design D6). */
export const previewNewAgentSchema = z.object({
  functionCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  agentName: z.string().trim().min(1).max(100).default('Agente'),
  answers,
});
export type PreviewNewAgentInput = z.input<typeof previewNewAgentSchema>;

export const saveFunctionDraftSchema = z.object({ answers });
export type SaveFunctionDraftInput = z.input<typeof saveFunctionDraftSchema>;

/**
 * Prévia e publicação de um agente existente. Campo omitido usa o que está salvo (respostas do
 * rascunho, ou as publicadas; modo e textos atuais).
 */
export const functionPublishSchema = z.object({
  answers: answers.optional(),
  mode: z.enum(['SIMPLE', 'ADVANCED', 'TAKEN_OVER']).optional(),
  additionalInstructions: z.string().max(1000).nullable().optional(),
  takenOverBehavior: z
    .string()
    .max(FUNCTION_BEHAVIOR_MAX + 1000)
    .nullable()
    .optional(),
});
export type FunctionPublishInput = z.input<typeof functionPublishSchema>;

export type FunctionPublicationStatus = 'IDLE' | 'PENDING' | 'FAILED';

export interface FunctionPreview {
  compiled: CompiledAgent;
  plan: PublicationPlan;
  /** Problemas das respostas; com algum, a publicação é recusada. */
  issues: AnswerIssue[];
  /** Versão do template publicada no agente (nula antes da primeira) e a que será usada. */
  version: { from: number | null; to: number };
  /** Site e vídeo que saem ao voltar para o modo simples (spec "Desligar o modo avançado"). */
  mediaToRemove: Array<{ id: string; type: 'WEBSITE' | 'VIDEO'; url: string | null }>;
  /** Nome das intenções que a publicação remove, pela chave: elas já não estão no compilado. */
  removedIntentions: Record<string, string>;
}

export interface AgentFunctionConfigView {
  function: { code: string; name: string; description: string };
  /** Versão publicada no agente; nula até a primeira publicação concluir. */
  version: number | null;
  latestVersion: number;
  /** Há versão mais nova do template e o agente segue o formulário (fora do controle assumido). */
  updateAvailable: boolean;
  mode: FunctionMode;
  answers: FunctionAnswers;
  /** Respostas salvas sem publicar. */
  draftAnswers: FunctionAnswers | null;
  additionalInstructions: string | null;
  takenOverBehavior: string | null;
  publication: { status: FunctionPublicationStatus; error: string | null };
  /** Motivo para republicar (ex.: um treinamento gerado sumiu do GPTMaker). */
  needsRepublishReason: string | null;
  /** Só tenants parceiros assumem o controle. */
  canTakeOver: boolean;
  /** Formulário da versão mais recente: é com ela que a próxima publicação compila. */
  form: FunctionTemplateContent;
}
