'use client';

import { useState } from 'react';
import { buttonClass } from '@/components/ui';
import { bx24SelectUsers, insideBitrix } from '@/lib/bx24';
import { useDealPipelines, useDealStages } from '@/lib/crm-fields';
import { Field, inputClass } from './agent-fields';

/** Seletores do Bitrix24 usados nos gatilhos, nas intenções e no formulário da função. */

const STAGE_SUFFIX: Record<string, string> = { success: ' (ganho)', failure: ' (perdido)' };

/**
 * Funil e etapa do negócio novo, escolhidos nas listas do portal; trocar o funil limpa a etapa
 * (a de outro funil seria inválida). Sem as listas (fora do Bitrix, sem permissão), digitados.
 */
export function PipelineStageFields({
  categoryId,
  stageId,
  disabled,
  onChange,
}: {
  categoryId: number;
  stageId: string;
  disabled?: boolean;
  onChange: (next: { categoryId?: number; stageId?: string }) => void;
}) {
  const pipelines = useDealPipelines();
  const stages = useDealStages(pipelines.data ? categoryId : null);

  if (!pipelines.data && pipelines.failed) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Funil (CATEGORY_ID)" hint="0 é o funil geral. Vale só para negócio novo.">
          <input
            type="number"
            min={0}
            className={inputClass}
            value={categoryId}
            disabled={disabled}
            onChange={(e) => onChange({ categoryId: Number(e.target.value) })}
          />
        </Field>
        <Field label="Etapa (STAGE_ID)" hint="Ex.: NEW, ou C3:NEW em outro funil.">
          <input
            className={`${inputClass} font-mono text-xs`}
            value={stageId}
            disabled={disabled}
            onChange={(e) => onChange({ stageId: e.target.value })}
          />
        </Field>
      </div>
    );
  }

  const stageMissing =
    stages.data && stageId !== '' && !stages.data.some((stage) => stage.id === stageId);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Funil" hint="Para negócio novo. Um negócio existente fica no funil dele.">
        <select
          className={inputClass}
          value={pipelines.data ? String(categoryId) : ''}
          disabled={disabled || !pipelines.data}
          onChange={(e) => onChange({ categoryId: Number(e.target.value), stageId: '' })}
        >
          {!pipelines.data && <option value="">Carregando funis…</option>}
          {pipelines.data?.map((pipeline) => (
            <option key={pipeline.id} value={pipeline.id}>
              {pipeline.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Etapa"
        hint={
          stageMissing
            ? `A etapa ${stageId} não existe neste funil; escolha outra.`
            : 'Negócio existente também vai para esta etapa.'
        }
      >
        {!pipelines.data || !stages.failed ? (
          <select
            className={inputClass}
            value={stages.data?.some((stage) => stage.id === stageId) ? stageId : ''}
            disabled={disabled || !stages.data}
            onChange={(e) => onChange({ stageId: e.target.value })}
          >
            <option value="">{stages.data ? 'Escolha a etapa…' : 'Carregando etapas…'}</option>
            {stages.data?.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
                {stage.semantics ? (STAGE_SUFFIX[stage.semantics] ?? '') : ''}
              </option>
            ))}
          </select>
        ) : (
          <input
            className={`${inputClass} font-mono text-xs`}
            value={stageId}
            disabled={disabled}
            onChange={(e) => onChange({ stageId: e.target.value })}
          />
        )}
      </Field>
    </div>
  );
}

export function ResponsiblePicker({
  value,
  onChange,
  disabled,
  label = 'Responsável',
}: {
  value: number;
  onChange: (id: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [name, setName] = useState<string | null>(null);
  const canPick = insideBitrix();
  return (
    <Field label={label} hint={canPick ? undefined : 'Informe o id do usuário no Bitrix24.'}>
      <div className="mt-1.5 flex items-center gap-2">
        {canPick ? (
          <>
            <span className="text-sm text-zinc-700">
              {value > 0 ? (name ?? `Usuário #${value}`) : 'Nenhum escolhido'}
            </span>
            <button
              type="button"
              className={buttonClass('secondary', 'sm')}
              disabled={disabled}
              onClick={async () => {
                const [user] = await bx24SelectUsers();
                if (user) {
                  onChange(Number(user.id));
                  setName(user.name);
                }
              }}
            >
              Escolher
            </button>
          </>
        ) : (
          <input
            type="number"
            min={1}
            className={`${inputClass} mt-0 w-40`}
            value={value || ''}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        )}
      </div>
    </Field>
  );
}
