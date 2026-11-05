import type { CompiledAgent, PublishedFunctionState } from '@gptmaker/contracts';
import { eq } from 'drizzle-orm';
import type { Database } from '../../shared/database/database.module';
import { agentFunctionConfig, agentManagedResource } from '../../shared/database/schema/index';

export type FunctionConfig = typeof agentFunctionConfig.$inferSelect;
export type ManagedResource = typeof agentManagedResource.$inferSelect;

/** Estado antes de qualquer publicação: nada aplicado no GPTMaker. */
export function emptyState(compiled: CompiledAgent): PublishedFunctionState {
  return {
    behavior: '',
    agentType: compiled.agentType,
    communicationType: compiled.communicationType,
    profile: { jobName: '', jobDescription: '', jobSite: '' },
    settings: {},
    trainings: [],
    intentions: [],
  };
}

/**
 * Estado publicado de verdade: comportamento e settings gravados na configuração; treinamentos e
 * intenções pelos recursos gerenciados, que a publicação grava passo a passo (design D5).
 */
export async function currentState(
  db: Database,
  config: FunctionConfig,
): Promise<{ state: PublishedFunctionState | null; resources: ManagedResource[] }> {
  const resources = await db
    .select()
    .from(agentManagedResource)
    .where(eq(agentManagedResource.agentId, config.agentId));
  if (!config.publishedState) return { state: null, resources };
  const of = (kind: ManagedResource['kind']) =>
    resources
      .filter((resource) => resource.kind === kind)
      .map((resource) => ({ key: resource.key, hash: resource.hash }));
  return {
    state: { ...config.publishedState, trainings: of('TRAINING'), intentions: of('INTENTION') },
    resources,
  };
}
