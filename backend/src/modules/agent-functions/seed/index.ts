import { SCHEDULING } from './agendamento';
import { POST_SALES } from './pos-venda';
import { SDR } from './sdr';
import { SUPPORT } from './suporte';
import type { SeedTemplate } from './types';

export { SEED_BLOCKS, type SeedBlock } from './blocks';
export type { SeedTemplate } from './types';

/** As quatro funções iniciais (tarefa 4), publicadas como versão 1 na primeira subida. */
export const SEED_TEMPLATES: readonly SeedTemplate[] = [SDR, SUPPORT, SCHEDULING, POST_SALES];
