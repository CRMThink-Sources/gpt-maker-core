import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import {
  agentFunctionConfig,
  agentManagedResource,
  training,
} from '../../shared/database/schema/index';
import {
  type ManagedTrainingGoneListener,
  type TrainingMediaPolicy,
  TrainingService,
  TrainingSyncService,
} from '../training';

/** Motivo mostrado ao cliente na página do agente. */
export const TRAINING_GONE_REASON =
  'Um treinamento gerado pelo formulário sumiu do GPTMaker. Publique de novo para recriá-lo.';

/**
 * Regras da função sobre os treinamentos: site e vídeo só com o modo avançado publicado (nem no
 * simples, nem no controle assumido), e treinamento gerado que some do GPTMaker marca o agente para republicar
 * (spec agent-training). Agente sem configuração de função é anterior às funções: regra antiga.
 */
@Injectable()
export class FunctionTrainingPolicy
  implements TrainingMediaPolicy, ManagedTrainingGoneListener, OnModuleInit
{
  constructor(
    private readonly trainings: TrainingService,
    private readonly sync: TrainingSyncService,
    @Inject(DB) private readonly db: Database,
  ) {}

  onModuleInit(): void {
    this.trainings.registerMediaPolicy(this);
    this.sync.registerManagedGoneListener(this);
  }

  /** Sem o recurso, a próxima publicação vê o item como novo e recria o treinamento. */
  async onManagedTrainingGone(event: { agentId: string; trainingId: string }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(agentManagedResource)
        .where(eq(agentManagedResource.trainingId, event.trainingId));
      await tx
        .update(agentFunctionConfig)
        .set({ needsRepublishReason: TRAINING_GONE_REASON })
        .where(eq(agentFunctionConfig.agentId, event.agentId));
    });
  }

  async refusal(agentId: string, type: 'TEXT' | 'WEBSITE' | 'VIDEO'): Promise<string | null> {
    const [config] = await this.db
      .select({ mode: agentFunctionConfig.mode })
      .from(agentFunctionConfig)
      .where(eq(agentFunctionConfig.agentId, agentId));
    if (!config) return null;
    if (type === 'TEXT') return 'TRAINING_FORM_ONLY';
    return config.mode === 'ADVANCED' ? null : 'TRAINING_ADVANCED_ONLY';
  }
}

/** Treinamentos de site e vídeo vivos do agente (saem ao publicar fora do modo avançado). */
export function mediaTrainings(db: Database, agentId: string) {
  return db
    .select({ id: training.id, type: training.type, url: training.url })
    .from(training)
    .where(
      and(
        eq(training.agentId, agentId),
        eq(training.managed, false),
        inArray(training.type, ['WEBSITE', 'VIDEO']),
        isNull(training.deletedAt),
      ),
    );
}
