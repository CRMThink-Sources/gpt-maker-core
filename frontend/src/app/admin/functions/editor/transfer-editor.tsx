'use client';

import {
  availableMarkers,
  type FunctionField,
  type FunctionTemplateContent,
  flattenFields,
} from '@gptmaker/contracts';
import { BotIcon, PlusIcon } from '@/components/icons';
import { Field, inputClass } from '../../../app/agents/agent-fields';
import { ConditionInput } from './intention-editor';
import { Issues, ItemActions, Segmented } from './kit';
import { MarkerText } from './marker-text';
import { type DraftTransfer, moveItem, slug, uniqueId } from './model';

type Content = Pick<FunctionTemplateContent, 'fields' | 'intentions'>;

/**
 * Transferências para outro agente (design D17): viram regras de transferência do agente no
 * GPTMaker. O cliente escolhe o agente num campo "Agente" do formulário.
 */
export function TransferList({
  content,
  transfers,
  issues,
  published = [],
  disabled,
  onChange,
}: {
  /** Conteúdo com os blocos expandidos: os campos dos blocos também valem aqui. */
  content: Content;
  transfers: DraftTransfer[];
  issues: (key: string) => string[];
  /** Chaves já publicadas: travadas. */
  published?: string[];
  disabled?: boolean;
  onChange: (transfers: DraftTransfer[]) => void;
}) {
  const fields = flattenFields(content.fields);
  const agents = fields.filter((field) => field.kind === 'AGENT');
  const choices = fields.filter(
    (field): field is Extract<FunctionField, { kind: 'CHOICE' | 'MULTI_CHOICE' }> =>
      field.kind === 'CHOICE' || field.kind === 'MULTI_CHOICE',
  );
  const markers = availableMarkers(content, { kind: 'behavior' });

  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900">Transferências entre agentes</h3>
        <p className="text-xs text-zinc-500">
          O agente passa a conversa para outro agente do portal, no mesmo chat. Crie antes um campo
          do tipo Agente para o cliente escolher o destino.
        </p>
      </div>
      {transfers.map((transfer, index) => {
        const set = (patch: Partial<DraftTransfer>) =>
          onChange(transfers.map((item, i) => (i === index ? { ...transfer, ...patch } : item)));
        const own = issues(transfer.key);
        const agentField = /^\{\{\s*([^}\s]+)\s*\}\}$/.exec(transfer.agent)?.[1] ?? '';
        const locked = published.includes(transfer.key);
        return (
          <div
            key={index}
            className={`space-y-3 rounded-xl border bg-white p-4 ${
              own.length ? 'border-red-300 ring-1 ring-red-100' : 'border-zinc-200'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex items-center gap-2 text-sm font-medium text-zinc-800">
                <BotIcon className="size-4 text-violet-600" />
                Transferência <code className="text-xs text-zinc-500">{transfer.key}</code>
              </span>
              <ItemActions
                disabled={disabled}
                onUp={index > 0 ? () => onChange(moveItem(transfers, index, -1)) : undefined}
                onDown={
                  index < transfers.length - 1
                    ? () => onChange(moveItem(transfers, index, 1))
                    : undefined
                }
                onRemove={() => onChange(transfers.filter((_, i) => i !== index))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Identificador"
                hint={locked ? 'Publicado: não muda.' : 'Liga a regra ao que já foi publicado.'}
              >
                <input
                  className={`${inputClass} font-mono text-xs`}
                  value={transfer.key}
                  disabled={disabled || locked}
                  onChange={(e) => set({ key: slug(e.target.value) })}
                />
              </Field>
              <Field label="Agente de destino">
                <select
                  className={inputClass}
                  value={agentField}
                  disabled={disabled}
                  onChange={(e) => set({ agent: e.target.value ? `{{${e.target.value}}}` : '' })}
                >
                  <option value="">Escolha um campo do tipo Agente</option>
                  {agents.map((field) => (
                    <option key={field.id} value={field.id}>
                      Do formulário: {field.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field
              label="Quando transferir"
              hint="O agente lê este texto para decidir, ex.: quando o cliente pedir um orçamento."
            >
              <MarkerText
                value={transfer.instructions}
                markers={markers}
                disabled={disabled}
                onChange={(instructions) => set({ instructions })}
              />
            </Field>
            <ConditionInput
              label="Só existe quando o cliente escolhe"
              value={transfer.when}
              choices={choices}
              disabled={disabled}
              onChange={(when) => set({ when })}
            />
            <div>
              <p className="mb-1.5 text-sm font-medium text-zinc-800">Quando o destino terminar</p>
              <Segmented
                label="Quando o destino terminar"
                disabled={disabled}
                value={transfer.returnOnFinish ? 'volta' : 'fica'}
                options={[
                  { value: 'fica', label: 'A conversa fica com o destino' },
                  { value: 'volta', label: 'Volta para este agente' },
                ]}
                onChange={(value) => set({ returnOnFinish: value === 'volta' })}
              />
            </div>
            <Issues messages={own} />
          </div>
        );
      })}
      {!disabled && transfers.length < 5 && (
        <button
          type="button"
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-700"
          onClick={() =>
            onChange([
              ...transfers,
              {
                key: uniqueId('transferencia', new Set(transfers.map((item) => item.key))),
                agent: agents[0] ? `{{${agents[0].id}}}` : '',
                instructions: 'Quando…',
                returnOnFinish: false,
              },
            ])
          }
        >
          <PlusIcon className="size-4" /> Adicionar transferência
        </button>
      )}
    </section>
  );
}
