'use client';

import { useEffect, useState } from 'react';
import { bx24Call, insideBitrix } from './bx24';

export type CrmEntity = 'lead' | 'deal';

export interface CrmFieldOption {
  id: string;
  label: string;
}

/** Campo do CRM para o seletor do gatilho. */
export interface CrmField {
  code: string;
  label: string;
  type: string;
  required: boolean;
  custom: boolean;
  /** Lista (`enumeration`) ou status do CRM (`crm_status`): valores aceitos, pelo id. */
  options?: CrmFieldOption[];
}

/** Metadado de `crm.lead.fields` / `crm.deal.fields` (só o que a tela usa). */
interface RawField {
  type: string;
  title?: string;
  formLabel?: string;
  listLabel?: string;
  isRequired?: boolean;
  isReadOnly?: boolean;
  statusType?: string;
  items?: Array<{ ID: string | number; VALUE: string }>;
}

/** Campos que o app preenche sozinho ou que não fazem sentido num template. */
const HIDDEN = new Set(['ID', 'CATEGORY_ID', 'STAGE_ID', 'CONTACT_ID', 'COMPANY_ID', 'LEAD_ID']);
/** Sim/não dos campos personalizados. */
const BOOLEAN_OPTIONS: CrmFieldOption[] = [
  { id: '1', label: 'Sim' },
  { id: '0', label: 'Não' },
];
/** Tipos sem valor em texto (arquivo, vínculos complexos). */
const UNSUPPORTED_TYPES = new Set([
  'crm_category',
  'file',
  'crm',
  'resourcebooking',
  'iblock_section',
  'iblock_element',
]);

const cache = new Map<CrmEntity, Promise<CrmField[]>>();

async function statusOptions(statusType: string): Promise<CrmFieldOption[]> {
  const rows = await bx24Call<Array<{ STATUS_ID: string; NAME: string }>>('crm.status.list', {
    filter: { ENTITY_ID: statusType },
    order: { SORT: 'ASC' },
  });
  return rows.map((row) => ({ id: row.STATUS_ID, label: row.NAME }));
}

async function loadFields(entity: CrmEntity): Promise<CrmField[]> {
  const raw = await bx24Call<Record<string, RawField>>(`crm.${entity}.fields`, {});
  const fields = await Promise.all(
    Object.entries(raw)
      .filter(
        ([code, field]) =>
          !field.isReadOnly && !HIDDEN.has(code) && !UNSUPPORTED_TYPES.has(field.type),
      )
      .map(async ([code, field]): Promise<CrmField> => {
        const custom = code.startsWith('UF_');
        let options: CrmFieldOption[] | undefined;
        if (field.type === 'enumeration' && field.items) {
          options = field.items.map((item) => ({ id: String(item.ID), label: item.VALUE }));
        } else if (field.type === 'boolean') {
          options = BOOLEAN_OPTIONS;
        } else if (field.type === 'crm_status' && field.statusType) {
          options = await statusOptions(field.statusType).catch(() => undefined);
        }
        return {
          code,
          // Campos personalizados trazem o nome dado pelo usuário em formLabel/listLabel.
          label: (custom ? field.formLabel || field.listLabel : field.title) || field.title || code,
          type: field.type,
          required: Boolean(field.isRequired),
          custom,
          ...(options ? { options } : {}),
        };
      }),
  );
  return fields.sort(
    (a, b) => Number(a.custom) - Number(b.custom) || a.label.localeCompare(b.label, 'pt-BR'),
  );
}

/**
 * Campos do lead ou do negócio no portal, lidos pelo BX24 com a sessão do usuário (uma vez por
 * entidade e por carregamento da página). Fora do Bitrix ou sem permissão no CRM ⇒ `fields`
 * nulo e `failed`; a tela cai para o código digitado.
 */
export function useCrmFields(entity: CrmEntity | undefined): {
  fields: CrmField[] | null;
  failed: boolean;
} {
  const [state, setState] = useState<{
    entity?: CrmEntity;
    fields: CrmField[] | null;
    failed: boolean;
  }>({
    fields: null,
    failed: false,
  });

  useEffect(() => {
    if (!entity || !insideBitrix()) return;
    let cancelled = false;
    let request = cache.get(entity);
    if (!request) {
      request = loadFields(entity);
      cache.set(entity, request);
      // Falhou: deixa tentar de novo na próxima abertura.
      request.catch(() => cache.delete(entity));
    }
    request
      .then((fields) => !cancelled && setState({ entity, fields, failed: false }))
      .catch(() => !cancelled && setState({ entity, fields: null, failed: true }));
    return () => {
      cancelled = true;
    };
  }, [entity]);

  if (!entity || !insideBitrix()) return { fields: null, failed: true };
  return state.entity === entity ? state : { fields: null, failed: false };
}
