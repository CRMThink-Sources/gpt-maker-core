import type { FunctionTranslations } from '@gptmaker/contracts';
import { SCHEDULING } from './agendamento';
import { SEED_BLOCKS as RAW_BLOCKS, type SeedBlock } from './blocks';
import { POST_SALES } from './pos-venda';
import { SDR } from './sdr';
import { SUPPORT } from './suporte';
import { SCHEDULING_TRANSLATIONS } from './translations/agendamento';
import { BLOCK_TRANSLATIONS } from './translations/blocks';
import { POST_SALES_TRANSLATIONS } from './translations/pos-venda';
import { SDR_TRANSLATIONS } from './translations/sdr';
import { SUPPORT_TRANSLATIONS } from './translations/suporte';
import type { SeedTemplate } from './types';

export { type SeedBlock } from './blocks';
export type { SeedTemplate } from './types';

/** Traduções en/es do formulário (spec function-template-i18n), pelo código da função. */
export const TEMPLATE_TRANSLATIONS: Record<string, FunctionTranslations> = {
  SDR: SDR_TRANSLATIONS,
  SUPPORT: SUPPORT_TRANSLATIONS,
  SCHEDULING: SCHEDULING_TRANSLATIONS,
  POST_SALES: POST_SALES_TRANSLATIONS,
};
export { BLOCK_TRANSLATIONS };

/** Os cinco blocos compartilhados, já com as traduções. */
export const SEED_BLOCKS: readonly SeedBlock[] = RAW_BLOCKS.map((block) => {
  const translations = BLOCK_TRANSLATIONS[block.code];
  return translations ? { ...block, content: { ...block.content, translations } } : block;
});

/** As quatro funções iniciais (tarefa 4), publicadas como versão 1 na primeira subida. */
export const SEED_TEMPLATES: readonly SeedTemplate[] = [SDR, SUPPORT, SCHEDULING, POST_SALES].map(
  (template) => {
    const translations = TEMPLATE_TRANSLATIONS[template.code];
    return translations ? { ...template, draft: { ...template.draft, translations } } : template;
  },
);
