/** Entidades do CRM vinculadas a um diálogo da Linha Aberta (id 0 ⇒ sem vínculo ⇒ ausente). */
export interface CrmBinding {
  lead?: number;
  deal?: number;
  contact?: number;
  company?: number;
}

export type CrmEntityType = keyof CrmBinding;

/** Ordem de preferência quando a ação vai para "a entidade do diálogo". */
export const CRM_PREFERENCE: readonly CrmEntityType[] = ['deal', 'lead', 'contact', 'company'];

/**
 * `entity_data_2` do chat da Linha Aberta (`imopenlines.dialog.get`): pares
 * `LEAD|id|COMPANY|id|CONTACT|id|DEAL|id`. O formato não é documentado; vem do exemplo da
 * documentação e de portais reais.
 */
export function parseCrmBinding(entityData2: unknown): CrmBinding {
  if (typeof entityData2 !== 'string') return {};
  const parts = entityData2.split('|');
  const binding: CrmBinding = {};
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const type = parts[i]!.trim().toLowerCase();
    const id = Number(parts[i + 1]);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (type === 'lead' || type === 'deal' || type === 'contact' || type === 'company') {
      binding[type] = id;
    }
  }
  return binding;
}

/** Primeira entidade vinculada na ordem de preferência. */
export function primaryEntity(binding: CrmBinding): { type: CrmEntityType; id: number } | null {
  for (const type of CRM_PREFERENCE) {
    const id = binding[type];
    if (id) return { type, id };
  }
  return null;
}

/** Prefixo do vínculo de tarefa com o CRM (`UF_CRM_TASK`: `L_5`, `D_123`, `C_7`, `CO_9`). */
export const TASK_CRM_PREFIX: Record<CrmEntityType, string> = {
  lead: 'L',
  deal: 'D',
  contact: 'C',
  company: 'CO',
};

/** Documento do business process: `["crm", "CCrmDocumentDeal", "DEAL_5"]`. */
export function bizprocDocumentId(type: CrmEntityType, id: number): [string, string, string] {
  const upper = type.toUpperCase();
  const object = `CCrmDocument${upper.charAt(0)}${upper.slice(1).toLowerCase()}`;
  return ['crm', object, `${upper}_${id}`];
}
