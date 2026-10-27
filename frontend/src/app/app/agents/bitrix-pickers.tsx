'use client';

import { useState } from 'react';
import { buttonClass } from '@/components/ui';
import { bx24SelectUsers, insideBitrix } from '@/lib/bx24';
import { useDealPipelines, useDealStages, useOpenLines } from '@/lib/crm-fields';
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

/**
 * Vários usuários do Bitrix24 (design D15): as ações vão para um de cada vez, em rodízio. Fora do
 * Bitrix24, os ids separados por vírgula.
 */
export function UsersPicker({
  value,
  onChange,
  disabled,
  label = 'Usuários',
}: {
  value: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [names, setNames] = useState<Record<number, string>>({});
  const [text, setText] = useState(value.join(', '));
  if (!insideBitrix()) {
    return (
      <Field
        label={label}
        hint="Ids dos usuários no Bitrix24, separados por vírgula. Recebem um de cada vez."
      >
        <input
          className={`${inputClass} mt-1.5`}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            const ids = e.target.value
              .split(/[\s,;]+/)
              .map(Number)
              .filter((id) => Number.isInteger(id) && id > 0);
            onChange([...new Set(ids)]);
          }}
        />
      </Field>
    );
  }
  return (
    <Field label={label} hint="Recebem um de cada vez, em rodízio.">
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {value.length === 0 && <span className="text-sm text-zinc-700">Nenhum escolhido</span>}
        {value.map((id) => (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pr-1 pl-2.5 text-xs text-zinc-700"
          >
            {names[id] ?? `Usuário #${id}`}
            {!disabled && (
              <button
                type="button"
                aria-label={`Tirar ${names[id] ?? id}`}
                className="rounded-full px-1 hover:bg-zinc-200"
                onClick={() => onChange(value.filter((item) => item !== id))}
              >
                ×
              </button>
            )}
          </span>
        ))}
        <button
          type="button"
          className={buttonClass('secondary', 'sm')}
          disabled={disabled}
          onClick={async () => {
            const users = await bx24SelectUsers();
            if (!users.length) return;
            setNames((current) => ({
              ...current,
              ...Object.fromEntries(users.map((user) => [Number(user.id), user.name])),
            }));
            onChange(
              [...new Set([...value, ...users.map((user) => Number(user.id))])].slice(0, 20),
            );
          }}
        >
          Adicionar
        </button>
      </div>
    </Field>
  );
}

/** Canal aberto do Bitrix24 que recebe a conversa (design D16). Sem a lista, o id digitado. */
export function OpenLinePicker({
  value,
  onChange,
  disabled,
  label = 'Canal aberto do Bitrix24',
}: {
  value: number;
  onChange: (id: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  const lines = useOpenLines();
  if (!lines.data) {
    return (
      <Field
        label={label}
        hint={lines.failed ? 'Informe o id do canal aberto no Bitrix24.' : undefined}
      >
        <input
          type="number"
          min={1}
          className={`${inputClass} mt-1.5 w-40`}
          value={value || ''}
          disabled={disabled || !lines.failed}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </Field>
    );
  }
  return (
    <Field label={label}>
      <select
        className={`${inputClass} mt-1.5`}
        value={value || ''}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        <option value="">Escolha um canal</option>
        {lines.data.map((line) => (
          <option key={line.id} value={line.id}>
            {line.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Outro agente do portal, destino de uma transferência entre agentes (design D17). */
export function AgentPicker({
  value,
  agents,
  onChange,
  disabled,
  label = 'Agente',
}: {
  value: string;
  agents: Array<{ id: string; name: string }>;
  onChange: (id: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <Field
      label={label}
      hint={agents.length === 0 ? 'Crie outro agente para poder transferir para ele.' : undefined}
    >
      <select
        className={`${inputClass} mt-1.5`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Escolha um agente</option>
        {agents.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
