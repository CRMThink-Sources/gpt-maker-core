'use client';

import {
  type AnswerIssue,
  type CompiledAgent,
  FUNCTION_BEHAVIOR_MAX,
  type FunctionAnswers,
  type FunctionTemplateContent,
  sampleAnswerSets,
} from '@gptmaker/contracts';
import { Alert, Badge, buttonClass } from '@/components/ui';
import { inputClass } from '../../../app/agents/agent-fields';
import { FunctionForm } from '../../../app/agents/function-form';
import { ACTION_TYPES, ActionTypeIcon } from './intention-editor';

const TONE_LABELS: Record<CompiledAgent['communicationType'], string> = {
  FORMAL: 'Formal',
  NORMAL: 'Cordial',
  RELAXED: 'Descontraído',
};

const SETTING_LABELS: Record<string, string> = {
  enabledHumanTransfer: 'Transferência para atendente',
  enabledEmoji: 'Emojis',
  limitSubjects: 'Só assuntos do negócio',
  knowledgeByFunction: 'Busca inteligente na base',
};

/** Texto compilado com o tamanho e a barra do limite. */
export function CompiledBehavior({ behavior }: { behavior: string }) {
  const over = behavior.length > FUNCTION_BEHAVIOR_MAX;
  return (
    <div>
      <div className="flex justify-between text-xs text-zinc-500">
        <span>Como o agente recebe o texto</span>
        <span className={over ? 'font-medium text-red-600' : ''}>
          {behavior.length} de {FUNCTION_BEHAVIOR_MAX} caracteres
        </span>
      </div>
      <pre className="mt-1 max-h-[36rem] overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs leading-relaxed whitespace-pre-wrap">
        {behavior || 'Vazio.'}
      </pre>
    </div>
  );
}

/**
 * Aba Testar: o formulário como o cliente vê e o agente que sai dele, compilado no navegador a
 * cada alteração (mesmo compilador do backend, sem precisar salvar).
 */
export function PreviewTab({
  content,
  compiled,
  answerIssues,
  worstAnswers,
  answers,
  onAnswers,
  agentName,
  onAgentName,
}: {
  content: FunctionTemplateContent;
  compiled: CompiledAgent | null;
  answerIssues: AnswerIssue[];
  /** Respostas do pior caso: o maior texto possível. */
  worstAnswers: FunctionAnswers | null;
  answers: FunctionAnswers;
  onAnswers: (answers: FunctionAnswers) => void;
  agentName: string;
  onAgentName: (name: string) => void;
}) {
  const enabled = compiled
    ? Object.entries(compiled.settings).filter(
        ([key, value]) => SETTING_LABELS[key] && typeof value === 'boolean',
      )
    : [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-200/80 bg-white p-3 shadow-xs">
        <label className="flex items-center gap-2 text-sm whitespace-nowrap text-zinc-600">
          Nome do agente
          <input
            className={`${inputClass} mt-0 w-40 py-1.5`}
            value={agentName}
            onChange={(e) => onAgentName(e.target.value)}
          />
        </label>
        <span className="mx-1 hidden h-6 w-px bg-zinc-200 sm:block" />
        <button
          type="button"
          className={buttonClass('secondary', 'sm')}
          onClick={() => onAnswers(sampleAnswerSets(content)[0] ?? {})}
        >
          Preencher com exemplo
        </button>
        <button
          type="button"
          className={buttonClass('secondary', 'sm')}
          disabled={!worstAnswers}
          title="Todos os campos no limite e a opção de texto mais longo em cada escolha"
          onClick={() => worstAnswers && onAnswers(worstAnswers)}
        >
          Maior texto possível
        </button>
        <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => onAnswers({})}>
          Limpar
        </button>
      </div>
      <div className="grid gap-4 2xl:grid-cols-2">
        <div className="min-w-0 rounded-2xl border border-zinc-200/80 bg-white shadow-xs">
          <p className="border-b border-zinc-100 px-5 py-3 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            Como o cliente vê
          </p>
          <div className="p-5">
            <FunctionForm
              form={content}
              answers={answers}
              onChange={onAnswers}
              issues={answerIssues}
            />
          </div>
        </div>
        <div className="min-w-0 rounded-2xl border border-zinc-200/80 bg-white shadow-xs">
          <p className="border-b border-zinc-100 px-5 py-3 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            Agente gerado
          </p>
          {compiled ? (
            <div className="space-y-5 p-5">
              {compiled.errors.map((item) => (
                <Alert key={item} tone="error">
                  {item}
                </Alert>
              ))}
              <CompiledBehavior behavior={compiled.behavior} />
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Badge tone="brand">Tom: {TONE_LABELS[compiled.communicationType]}</Badge>
                {enabled.map(([key, value]) => (
                  <Badge key={key} tone={value ? 'green' : 'zinc'}>
                    {SETTING_LABELS[key]}: {value ? 'ligado' : 'desligado'}
                  </Badge>
                ))}
              </div>
              <div>
                <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                  Ações que o agente terá ({compiled.intentions.length})
                </p>
                <ul className="mt-2 divide-y divide-zinc-100 rounded-xl border border-zinc-200">
                  {compiled.intentions.map((intention) => (
                    <li key={intention.key} className="px-3 py-2">
                      <p className="text-sm font-medium text-zinc-800">{intention.input.name}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                        {intention.input.actions.map((action, index) => (
                          <span key={index} className="flex items-center gap-1">
                            {index > 0 && <span className="text-zinc-300">→</span>}
                            <ActionTypeIcon type={action.type} />
                            {ACTION_TYPES[action.type] ?? action.type}
                          </span>
                        ))}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                  Itens da base ({compiled.trainings.length})
                </p>
                <ul className="mt-2 space-y-2 text-xs text-zinc-700">
                  {compiled.trainings.map((item) => (
                    <li
                      key={item.key}
                      className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 whitespace-pre-wrap"
                    >
                      {item.text}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="p-5">
              <Alert tone="error">
                O rascunho ainda não compila. Corrija os problemas do painel ao lado.
              </Alert>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
