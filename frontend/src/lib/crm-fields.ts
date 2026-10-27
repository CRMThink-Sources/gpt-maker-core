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

export interface DealPipeline {
  id: number;
  name: string;
}

export interface DealStage {
  id: string;
  name: string;
  /** `process`, `success` (ganho) ou `failure` (perdido). */
  semantics: string | null;
}

const pipelinesCache: { request?: Promise<DealPipeline[]> } = {};
const stagesCache = new Map<number, Promise<DealStage[]>>();

async function loadPipelines(): Promise<DealPipeline[]> {
  const data = await bx24Call<{
    categories: Array<{ id: number; name: string; isDefault: string; sort: number }>;
  }>('crm.category.list', { entityTypeId: 2 });
  return data.categories
    .map((category) => ({ ...category, isDefault: category.isDefault === 'Y' }))
    .sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        a.sort - b.sort ||
        a.name.localeCompare(b.name, 'pt-BR'),
    )
    .map(({ id, name }) => ({ id: Number(id), name }));
}

/** Etapas do funil: `DEAL_STAGE` no funil geral (0), `DEAL_STAGE_<id>` nos demais. */
async function loadStages(pipelineId: number): Promise<DealStage[]> {
  const rows = await bx24Call<
    Array<{ STATUS_ID: string; NAME: string; SEMANTICS?: string; EXTRA?: { SEMANTICS?: string } }>
  >('crm.status.list', {
    filter: { ENTITY_ID: pipelineId === 0 ? 'DEAL_STAGE' : `DEAL_STAGE_${pipelineId}` },
    order: { SORT: 'ASC' },
  });
  return rows.map((row) => ({
    id: row.STATUS_ID,
    name: row.NAME,
    semantics: row.SEMANTICS ?? row.EXTRA?.SEMANTICS ?? null,
  }));
}

export interface OpenLine {
  id: number;
  name: string;
}

const openLinesCache: { request?: Promise<OpenLine[]> } = {};

/** Canais abertos (Linhas Abertas) do portal, por nome (design D16). */
async function loadOpenLines(): Promise<OpenLine[]> {
  const data = await bx24Call<Array<{ ID: string | number; LINE_NAME: string }>>(
    'imopenlines.config.list.get',
    {},
  );
  return data
    .map((line) => ({ id: Number(line.ID), name: line.LINE_NAME }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

/** Uma chamada por chave e por carregamento da página; falha libera nova tentativa. */
function cached<T>(
  get: () => Promise<T> | undefined,
  set: (p: Promise<T> | undefined) => void,
  load: () => Promise<T>,
) {
  let request = get();
  if (!request) {
    request = load();
    set(request);
    request.catch(() => set(undefined));
  }
  return request;
}

function useBitrixList<T>(
  key: string | null,
  load: () => Promise<T>,
): { data: T | null; failed: boolean } {
  const [state, setState] = useState<{ key: string | null; data: T | null; failed: boolean }>({
    key: null,
    data: null,
    failed: false,
  });
  useEffect(() => {
    if (key === null || !insideBitrix()) return;
    let cancelled = false;
    load()
      .then((data) => !cancelled && setState({ key, data, failed: false }))
      .catch(() => !cancelled && setState({ key, data: null, failed: true }));
    return () => {
      cancelled = true;
    };
    // `load` muda a cada render; a chave identifica a lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (key === null || !insideBitrix()) return { data: null, failed: true };
  return state.key === key
    ? { data: state.data, failed: state.failed }
    : { data: null, failed: false };
}

/** Canais abertos do portal (transferência para um canal). */
export function useOpenLines() {
  return useBitrixList('openlines', () =>
    cached(
      () => openLinesCache.request,
      (request) => (openLinesCache.request = request),
      loadOpenLines,
    ),
  );
}

/** Funis de negócio do portal, o geral primeiro. */
export function useDealPipelines() {
  return useBitrixList('pipelines', () =>
    cached(
      () => pipelinesCache.request,
      (request) => (pipelinesCache.request = request),
      loadPipelines,
    ),
  );
}

/** Etapas de um funil, na ordem do Bitrix24. */
export function useDealStages(pipelineId: number | null) {
  return useBitrixList(pipelineId === null ? null : `stages:${pipelineId}`, () =>
    cached(
      () => stagesCache.get(pipelineId!),
      (request) =>
        request ? stagesCache.set(pipelineId!, request) : stagesCache.delete(pipelineId!),
      () => loadStages(pipelineId!),
    ),
  );
}
