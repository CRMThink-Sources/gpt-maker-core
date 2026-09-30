import { z } from 'zod';

export const agentTypeSchema = z.enum(['SUPPORT', 'SALE', 'PERSONAL']);
export const communicationTypeSchema = z.enum(['FORMAL', 'NORMAL', 'RELAXED']);
export const agentStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'OUT_OF_SYNC']);

const optionalText = (max: number) => z.string().trim().max(max).optional();

/** Formulário de novo agente (spec agent-management). Sem `modelId`, vale o padrão do catálogo. */
export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  avatarUrl: z.url().max(2000).optional(),
  behavior: optionalText(10_000),
  type: agentTypeSchema,
  communicationType: communicationTypeSchema,
  jobName: optionalText(200),
  jobSite: z.url().max(2000).optional(),
  jobDescription: optionalText(5000),
  modelId: z.uuid().optional(),
});
export type CreateAgentInput = z.input<typeof createAgentSchema>;

/** Agente como o frontend o vê: nome sem o prefixo do tenant e sem ids do GPTMaker. */
export interface AgentView {
  id: string;
  name: string;
  avatarUrl: string | null;
  behavior: string | null;
  type: z.infer<typeof agentTypeSchema>;
  communicationType: z.infer<typeof communicationTypeSchema>;
  jobName: string | null;
  jobSite: string | null;
  jobDescription: string | null;
  model: { id: string; code: string; displayName: string; creditsPerResponse: number };
  status: z.infer<typeof agentStatusSchema>;
  inactiveReason: string | null;
  createdAt: string;
  updatedAt: string;
}
