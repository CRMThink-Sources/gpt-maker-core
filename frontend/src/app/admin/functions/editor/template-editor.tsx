'use client';

import {
  type AgentSettings,
  availableMarkers,
  checkTemplate,
  compileAgent,
  CRM_SYSTEM_INTENTION_NAME,
  expandBlocks,
  FUNCTION_BEHAVIOR_MAX,
  type FunctionAnswers,
  type FunctionBlockContent,
  functionBlockContentSchema,
  type FunctionTemplateDraft,
  functionTemplateDraftSchema,
  type TemplateCheck,
  type TemplateIssue,
  validateFunctionAnswers,
} from '@gptmaker/contracts';
import { useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import type { z } from 'zod';
import { Badge, buttonClass, Card } from '@/components/ui';
import { Field, inputClass } from '../../../app/agents/agent-fields';
import { checkJson } from './json';
import { type FieldContext, FieldList, type Rename } from './field-editor';
import { FocusContext, type FocusTarget } from './focus';
import { IntentionList } from './intention-editor';
import { MarkerText } from './marker-text';
import { allIds, KIND_LABELS, type Published, renameId, renameOption } from './model';
import { CompiledBehavior, PreviewTab } from './preview-tab';

type Tab = 'general' | 'form' | 'behavior' | 'actions' | 'preview' | 'json';

const TAB_LABELS: Record<Tab, string> = {
  general: 'Geral',
  form: 'Formulário',
  behavior: 'Texto do agente',
  actions: 'Ações',
  preview: 'Testar',
  json: 'JSON',
};

/** O que se faz em cada aba: uma linha abaixo das abas. */
const TAB_HINTS: Record<Tab, string> = {
  general: 'Tipo do agente, configurações e blocos compartilhados que a função inclui.',
  form: 'As perguntas que o cliente responde, na ordem em que ele vê.',
  behavior:
    'O texto que o agente segue. Cada resposta entra no seu marcador {{…}}; numa escolha, entra o texto da opção.',
  actions: 'O que o agente faz no Bitrix24 e quando.',
  preview:
    'Responda como um cliente e veja o agente que sai. Atualiza enquanto você edita, sem salvar.',
  json: 'O mesmo conteúdo em JSON, para o que as outras abas não cobrem.',
};

const SECTION_TAB: Record<TemplateIssue['where']['section'], Tab> = {
  general: 'general',
  form: 'form',
  behavior: 'behavior',
  actions: 'actions',
};

const DERIVED: Array<[keyof AgentSettings, string]> = [
  ['enabledHumanTransfer', 'Transferência para atendente'],
  ['limitSubjects', 'Falar só dos assuntos do negócio'],
  ['knowledgeByFunction', 'Busca inteligente na base'],
];

function Tabs({
  tab,
  onTab,
  tabs,
  counts,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  tabs: Tab[];
  counts: Partial<Record<Tab, number>>;
}) {
  return (
    <nav
      className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-zinc-200"
      role="tablist"
    >
      {tabs.map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={tab === key}
          onClick={() => onTab(key)}
          className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 pb-2.5 text-sm font-medium ${
            tab === key
              ? 'border-brand-600 text-brand-700'
              : 'border-transparent text-zinc-500 hover:text-zinc-800'
          }`}
        >
          {TAB_LABELS[key]}
          {counts[key] ? (
            <span className="rounded-full bg-red-100 px-1.5 text-xs text-red-700">
              {counts[key]}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}

/** Seção JSON: o mesmo conteúdo; texto inválido não altera as outras seções (design D12). */
function JsonTab<T>({
  value,
  schema,
  onChange,
  disabled,
}: {
  value: T;
  schema: z.ZodType<T>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const check = useMemo(() => checkJson(text, schema), [text, schema]);
  return (
    <div>
      <textarea
        className={`${inputClass} min-h-[32rem] font-mono text-xs leading-relaxed`}
        spellCheck={false}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = checkJson(e.target.value, schema);
          if (parsed.value) onChange(parsed.value);
        }}
      />
      {check.errors.length > 0 ? (
        <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto text-xs text-red-700">
          {check.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
          <li className="text-zinc-500">As outras seções seguem com o último conteúdo válido.</li>
        </ul>
      ) : (
        <p className="mt-2 text-xs text-emerald-700">Estrutura válida.</p>
      )}
    </div>
  );
}

function issueFinder(issues: TemplateIssue[]) {
  return {
    field: (fieldId: string, option?: string) =>
      issues
        .filter(
          (issue) =>
            issue.where.fieldId === fieldId &&
            (option === undefined
              ? issue.where.option === undefined
              : issue.where.option === option),
        )
        .map((issue) => issue.message),
    intention: (key: string, actionIndex?: number) =>
      issues
        .filter(
          (issue) => issue.where.intentionKey === key && issue.where.actionIndex === actionIndex,
        )
        .map((issue) => issue.message),
    section: (section: TemplateIssue['where']['section']) =>
      issues
        .filter(
          (issue) =>
            issue.where.section === section && !issue.where.fieldId && !issue.where.intentionKey,
        )
        .map((issue) => issue.message),
  };
}

/** Problema do painel, com o lugar para onde o clique leva. */
interface Problem {
  message: string;
  tab: Tab;
  where?: TemplateIssue['where'];
}

/** Problemas que impedem publicar: blocos e checagem do template. */
export function templateProblems(live: LiveTemplate): Problem[] {
  return [
    ...live.blockErrors.map((message) => ({ message, tab: 'general' as Tab })),
    ...live.issues.map((issue) => ({
      message: issue.message,
      tab: SECTION_TAB[issue.where.section],
      where: issue.where,
    })),
  ];
}

/** Painel da checagem ao vivo: tamanho máximo e problemas, com atalho para o lugar (spec D12). */
function CheckPanel({
  check,
  problems,
  labels,
  onGo,
}: {
  check: TemplateCheck | null;
  problems: Problem[];
  /** Nome legível de cada marcador (rótulo da pergunta, nome do bloco). */
  labels: Map<string, string>;
  onGo: (problem: Problem) => void;
}) {
  if (!check) return null;
  const { budget } = check;
  const over = budget.length > FUNCTION_BEHAVIOR_MAX;
  const top = Object.entries(budget.markers)
    .filter(([, length]) => length > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6);
  return (
    <Card className="space-y-4 p-4 text-sm">
      <div>
        <div className="flex justify-between text-xs text-zinc-500">
          <span title="Com todas as respostas no limite e a opção de texto mais longo em cada escolha">
            Tamanho máximo do texto do agente
          </span>
          <span className={over ? 'font-medium text-red-600' : ''}>
            {budget.length} de {FUNCTION_BEHAVIOR_MAX}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100">
          <div
            className={`h-full rounded-full ${over ? 'bg-red-500' : budget.length > 2900 ? 'bg-amber-500' : 'bg-brand-500'}`}
            style={{ width: `${Math.min(1, budget.length / FUNCTION_BEHAVIOR_MAX) * 100}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Com todas as respostas no limite. O que mais pesa:
        </p>
        <ul className="mt-1 space-y-0.5 text-xs text-zinc-600">
          <li className="flex justify-between">
            <span>Texto fixo</span>
            <span>{budget.fixed}</span>
          </li>
          {top.map(([path, length]) => (
            <li key={path} className="flex justify-between gap-2">
              <span className="truncate" title={`{{${path}}}`}>
                {labels.get(path) ?? path}
              </span>
              <span>{length}</span>
            </li>
          ))}
        </ul>
      </div>
      {problems.length === 0 ? (
        <p className="text-xs text-emerald-700">Pronto para publicar.</p>
      ) : (
        <div>
          <p className="text-xs font-medium text-red-700">
            {problems.length === 1
              ? '1 problema impede publicar'
              : `${problems.length} problemas impedem publicar`}
          </p>
          <ul className="mt-1 space-y-1 text-xs">
            {problems.map((problem, index) => (
              <li key={index}>
                <button
                  type="button"
                  className="text-left text-red-700 hover:underline"
                  onClick={() => onGo(problem)}
                >
                  {TAB_LABELS[problem.tab]}: {problem.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/** Aplica a lista de campos editada e renomeia as referências quando um id ou valor mudou. */
function withFields<
  T extends {
    fields: FunctionTemplateDraft['fields'];
    intentions: FunctionTemplateDraft['intentions'];
  },
>(value: T, fields: T['fields'], rename?: Rename): T {
  let next = { ...value, fields };
  if (rename?.kind === 'id') next = renameId(next, rename.from, rename.to);
  if (rename?.kind === 'option') {
    next = {
      ...next,
      intentions: renameOption(next.intentions, rename.fieldId, rename.from, rename.to),
    };
  }
  return next;
}

export type LiveTemplate = ReturnType<typeof useLiveTemplate>;

/** Rascunho com os blocos expandidos e a checagem, recalculados enquanto se edita. */
export function useLiveTemplate(
  draft: FunctionTemplateDraft,
  blocks: Map<string, { name: string; content: FunctionBlockContent }>,
) {
  const deferred = useDeferredValue(draft);
  const contents = useMemo(
    () => new Map([...blocks].map(([code, block]) => [code, block.content])),
    [blocks],
  );
  return useMemo(() => {
    const { content, errors } = expandBlocks(deferred, contents);
    const structure = structureIssues(deferred);
    try {
      const check = checkTemplate(content);
      return { content, blockErrors: errors, check, issues: [...structure, ...check.issues] };
    } catch {
      return { content, blockErrors: errors, check: null, issues: structure };
    }
  }, [deferred, contents]);
}

/** Nome em palavras da propriedade que falhou na validação de estrutura. */
const PROPERTY_LABELS: Record<string, string> = {
  label: 'o rótulo',
  name: 'o nome',
  whenToUse: '"quando o agente usa"',
  actions: 'os passos no Bitrix24',
  options: 'as opções',
  behavior: 'o texto do agente',
  format: 'o texto do treinamento',
  subfields: 'os campos do item',
};

/**
 * Problemas de estrutura do rascunho (campo vazio, lista sem itens), que antes só apareciam ao
 * salvar: com o lugar (pergunta, opção ou ação) e em português.
 */
function structureIssues(draft: FunctionTemplateDraft): TemplateIssue[] {
  const parsed = functionTemplateDraftSchema.safeParse(draft);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => {
    const where: TemplateIssue['where'] = { section: 'general' };
    let node: unknown = draft;
    let name: string | undefined;
    for (const [index, key] of issue.path.entries()) {
      if (index === 0) {
        where.section =
          key === 'fields'
            ? 'form'
            : key === 'intentions'
              ? 'actions'
              : key === 'behavior'
                ? 'behavior'
                : 'general';
      }
      node = (node as Record<PropertyKey, unknown> | undefined)?.[key as PropertyKey];
      const item = node as { id?: unknown; kind?: unknown; key?: unknown; value?: unknown } | null;
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      if (typeof item.kind === 'string' && typeof item.id === 'string') {
        where.fieldId = item.id;
        where.option = undefined;
        name = (item as { label?: string }).label;
      } else if (where.section === 'actions' && index === 1 && typeof item.key === 'string') {
        where.intentionKey = item.key;
        name = (item as { name?: string }).name;
      } else if (where.fieldId && typeof item.value === 'string' && 'snippet' in item) {
        where.option = item.value;
        name = `${name ?? ''}, opção ${(item as { label?: string }).label || item.value}`;
      }
    }
    const last = String(issue.path.at(-1) ?? '');
    const property = PROPERTY_LABELS[last] ?? last;
    const message = issue.message.startsWith('Too small')
      ? issue.message.includes('array')
        ? `${property} precisa de pelo menos um item`
        : `${property} não pode ficar vazio`
      : issue.message;
    return { where, message: name ? `${name}: ${message}` : message };
  });
}

/** Editor visual de um template de função (spec admin-backoffice, design D12). */
export function TemplateEditor({
  draft,
  live,
  onChange,
  published,
  publishedIntentions,
  blocks,
  prefix,
  disabled,
  answers,
  onAnswers,
  agentName,
  onAgentName,
}: {
  draft: FunctionTemplateDraft;
  /** `useLiveTemplate(draft, blocks)`: a página também usa para liberar a publicação. */
  live: LiveTemplate;
  onChange: (draft: FunctionTemplateDraft) => void;
  published: Published;
  publishedIntentions: string[];
  /** Blocos publicados, pelo código. */
  blocks: Map<string, { name: string; content: FunctionBlockContent }>;
  prefix: string;
  disabled?: boolean;
  /** Respostas de exemplo da aba Testar (também vão para o sandbox). */
  answers: FunctionAnswers;
  onAnswers: (answers: FunctionAnswers) => void;
  agentName: string;
  onAgentName: (name: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('form');
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [sideBySide, setSideBySide] = useState(true);

  // Prévia no navegador: o mesmo compilador do backend, sem salvar.
  const preview = useMemo(() => {
    const { answers: valid, issues } = validateFunctionAnswers(live.content, answers, {
      partial: true,
    });
    try {
      const compiled = compileAgent({
        content: live.content,
        answers: valid,
        agentName: agentName.trim() || 'Agente',
        mode: 'SIMPLE',
      });
      return { compiled, issues };
    } catch {
      return { compiled: null, issues };
    }
  }, [live.content, answers, agentName]);

  const go = (problem: Problem) => {
    setTab(problem.tab);
    setFocus({
      fieldId: problem.where?.fieldId,
      intentionKey: problem.where?.intentionKey,
      nonce: Date.now(),
    });
  };
  const switchTab = (next: Tab) => {
    setTab(next);
    setFocus(null);
  };

  const issues = live.issues;
  const find = issueFinder(issues);
  const counts: Partial<Record<Tab, number>> = {};
  for (const issue of issues)
    counts[SECTION_TAB[issue.where.section]] = (counts[SECTION_TAB[issue.where.section]] ?? 0) + 1;
  if (live.blockErrors.length) counts.general = (counts.general ?? 0) + live.blockErrors.length;

  const markers = availableMarkers(live.content, { kind: 'behavior' }, { blocks: draft.blocks });
  const ctx: FieldContext = {
    prefix,
    published,
    takenIds: allIds(live.content.fields),
    markers: availableMarkers(live.content, { kind: 'snippet' }),
    issues: find.field,
    disabled,
  };
  const set = (patch: Partial<FunctionTemplateDraft>) => onChange({ ...draft, ...patch });
  const blockFields = draft.blocks.flatMap((code) => {
    const block = blocks.get(code);
    return block ? block.content.fields.map((field) => ({ code, name: block.name, field })) : [];
  });
  const labels = new Map(markers.map((item) => [item.marker, item.label]));

  return (
    <FocusContext.Provider value={focus}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-4">
          <div>
            <Tabs
              tab={tab}
              onTab={switchTab}
              tabs={['general', 'form', 'behavior', 'actions', 'preview', 'json']}
              counts={counts}
            />
            <p className="mt-2 text-xs text-zinc-500">{TAB_HINTS[tab]}</p>
          </div>

          {tab === 'general' && (
            <div className="space-y-5">
              <Field label="Tipo do agente no GPTMaker">
                <select
                  className={`${inputClass} w-56`}
                  value={draft.agentType}
                  disabled={disabled}
                  onChange={(e) =>
                    set({ agentType: e.target.value as FunctionTemplateDraft['agentType'] })
                  }
                >
                  <option value="SALE">Vendas</option>
                  <option value="SUPPORT">Suporte</option>
                  <option value="PERSONAL">Pessoal</option>
                </select>
              </Field>
              <div>
                <p className="text-sm font-medium text-zinc-800">Configurações do agente</p>
                <div className="mt-2 flex flex-wrap gap-4">
                  {DERIVED.map(([key, label]) => (
                    <Field key={key} label={label}>
                      <select
                        className={`${inputClass} w-36`}
                        value={draft.settings[key] === undefined ? '' : String(draft.settings[key])}
                        disabled={disabled}
                        onChange={(e) => {
                          const settings = { ...draft.settings } as Record<string, unknown>;
                          if (e.target.value === '') delete settings[key];
                          else settings[key] = e.target.value === 'true';
                          set({ settings: settings as AgentSettings });
                        }}
                      >
                        <option value="">Padrão</option>
                        <option value="true">Ligado</option>
                        <option value="false">Desligado</option>
                      </select>
                    </Field>
                  ))}
                </div>
                <Field label="Mensagem quando o agente não souber (opcional)">
                  <input
                    className={inputClass}
                    value={draft.settings.onLackKnowLedge ?? ''}
                    disabled={disabled}
                    onChange={(e) =>
                      set({
                        settings: {
                          ...draft.settings,
                          onLackKnowLedge: e.target.value || undefined,
                        },
                      })
                    }
                  />
                </Field>
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-800">Blocos incluídos</p>
                <p className="text-xs text-zinc-500">
                  Campos, texto e ações compartilhados entre as funções.
                </p>
                <div className="mt-2 flex flex-wrap gap-4">
                  {[...blocks].map(([code, block]) => (
                    <label key={code} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-brand-600"
                        checked={draft.blocks.includes(code)}
                        disabled={disabled}
                        onChange={(e) =>
                          set({
                            blocks: e.target.checked
                              ? [...draft.blocks, code]
                              : draft.blocks.filter((c) => c !== code),
                          })
                        }
                      />
                      {block.name}
                    </label>
                  ))}
                </div>
                {live.blockErrors.map((error) => (
                  <p key={error} className="mt-1 text-xs text-red-600">
                    {error}
                  </p>
                ))}
              </div>
              <CrmAccessToggle
                checked={draft.crmAccess}
                disabled={disabled}
                onChange={(crmAccess) => set({ crmAccess })}
                requiredBy={draft.blocks.flatMap((code) => {
                  const block = blocks.get(code);
                  return block?.content.crmAccess ? [block.name] : [];
                })}
              />
              <div className="space-y-3">
                <p className="text-sm font-medium text-zinc-800">
                  Dados da empresa enviados ao GPTMaker
                </p>
                {(['jobName', 'jobDescription', 'jobSite'] as const).map((key) => (
                  <Field
                    key={key}
                    label={
                      {
                        jobName: 'Nome da empresa',
                        jobDescription: 'Sobre a empresa',
                        jobSite: 'Site',
                      }[key]
                    }
                  >
                    <MarkerText
                      value={draft.profile[key]}
                      rows={1}
                      markers={markers.filter((m) => !m.marker.startsWith('bloco.'))}
                      disabled={disabled}
                      onChange={(value) => set({ profile: { ...draft.profile, [key]: value } })}
                    />
                  </Field>
                ))}
                {find.section('general').map((message) => (
                  <p key={message} className="text-xs text-red-600">
                    {message}
                  </p>
                ))}
              </div>
            </div>
          )}

          {tab === 'form' && (
            <div className="space-y-4">
              {blockFields.length > 0 && (
                <div className="rounded-lg border border-dashed border-zinc-300 p-3 text-xs text-zinc-600">
                  <p className="font-medium">Vêm dos blocos (edite em Blocos compartilhados):</p>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {blockFields.map(({ code, field }) => (
                      <li key={`${code}:${field.id}`}>
                        <Badge tone="zinc">
                          {field.label} · {KIND_LABELS[field.kind]}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <FieldList
                fields={draft.fields}
                ctx={ctx}
                onChange={(fields, rename) => onChange(withFields(draft, fields, rename))}
              />
            </div>
          )}

          {tab === 'behavior' && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <label className="flex items-center gap-2 text-xs text-zinc-600">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-600"
                    checked={sideBySide}
                    onChange={(e) => setSideBySide(e.target.checked)}
                  />
                  Ver como fica ao lado
                </label>
              </div>
              <div className={sideBySide ? 'grid gap-4 xl:grid-cols-2' : ''}>
                <div className="min-w-0">
                  <MarkerText
                    value={draft.behavior}
                    rows={28}
                    mono
                    markers={markers}
                    disabled={disabled}
                    onChange={(behavior) => set({ behavior })}
                  />
                  {find.section('behavior').map((message) => (
                    <p key={message} className="text-xs text-red-600">
                      {message}
                    </p>
                  ))}
                </div>
                {sideBySide && (
                  <div className="min-w-0 space-y-2">
                    {preview.compiled ? (
                      <CompiledBehavior behavior={preview.compiled.behavior} />
                    ) : (
                      <p className="text-xs text-red-600">O rascunho ainda não compila.</p>
                    )}
                    <p className="text-xs text-zinc-500">
                      Com as respostas da aba{' '}
                      <button
                        type="button"
                        className={`${buttonClass('ghost', 'sm')} h-auto px-1`}
                        onClick={() => switchTab('preview')}
                      >
                        Testar
                      </button>
                      {Object.keys(answers).length === 0 &&
                        '(ainda vazias: preencha um exemplo lá)'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'actions' && (
            <IntentionList
              content={{ fields: live.content.fields, intentions: draft.intentions }}
              intentions={draft.intentions}
              issues={find.intention}
              published={publishedIntentions}
              disabled={disabled}
              onChange={(intentions) => set({ intentions })}
            />
          )}

          {tab === 'preview' && (
            <PreviewTab
              content={live.content}
              compiled={preview.compiled}
              answerIssues={preview.issues}
              worstAnswers={live.check?.budget.answers ?? null}
              answers={answers}
              onAnswers={onAnswers}
              agentName={agentName}
              onAgentName={onAgentName}
            />
          )}

          {tab === 'json' && (
            <JsonTab
              value={draft}
              schema={functionTemplateDraftSchema}
              disabled={disabled}
              onChange={onChange}
            />
          )}
        </div>
        <div className="lg:sticky lg:top-20 lg:self-start">
          <CheckPanel
            check={live.check}
            problems={templateProblems(live)}
            labels={labels}
            onGo={go}
          />
        </div>
      </div>
    </FocusContext.Provider>
  );
}

/** `crmAccess` do template ou do bloco: a publicação no agente liga o acesso ao CRM. */
function CrmAccessToggle({
  checked,
  disabled,
  onChange,
  requiredBy = [],
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  /** Blocos incluídos que já exigem (só no template). */
  requiredBy?: string[];
}) {
  return (
    <div>
      <label className="flex items-center gap-2 text-sm font-medium text-zinc-800">
        <input
          type="checkbox"
          className="size-4 accent-brand-600"
          checked={checked || requiredBy.length > 0}
          disabled={disabled || requiredBy.length > 0}
          onChange={(e) => onChange(e.target.checked)}
        />
        Exige acesso ao CRM
      </label>
      <p className="mt-1 text-xs text-zinc-500">
        Ao publicar a função num agente, o acesso ao CRM dele é ativado (ação &quot;
        {CRM_SYSTEM_INTENTION_NAME}&quot; e consultas ao CRM). Para usar no texto, cite a ação pelo
        nome.
        {requiredBy.length > 0 && <> Exigido pelo bloco {requiredBy.join(', ')}.</>}
      </p>
    </div>
  );
}

/** Editor visual de um bloco compartilhado: formulário, texto e ações, sem checagem de orçamento. */
export function BlockEditor({
  value,
  onChange,
  prefix,
  disabled,
  footer,
}: {
  value: FunctionBlockContent;
  onChange: (value: FunctionBlockContent) => void;
  prefix: string;
  disabled?: boolean;
  footer?: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>('form');
  const content = { fields: value.fields, intentions: value.intentions };
  const ctx: FieldContext = {
    prefix,
    published: {},
    takenIds: allIds(value.fields),
    markers: availableMarkers(content, { kind: 'snippet' }),
    issues: () => [],
    disabled,
  };
  return (
    <div className="space-y-4">
      <CrmAccessToggle
        checked={value.crmAccess}
        disabled={disabled}
        onChange={(crmAccess) => onChange({ ...value, crmAccess })}
      />
      <Tabs tab={tab} onTab={setTab} tabs={['form', 'behavior', 'actions', 'json']} counts={{}} />
      {tab === 'form' && (
        <FieldList
          fields={value.fields}
          ctx={ctx}
          onChange={(fields, rename) => onChange(withFields(value, fields, rename))}
        />
      )}
      {tab === 'behavior' && (
        <div className="space-y-2">
          <p className="text-sm text-zinc-600">
            Entra no texto do agente onde o template usa {'{{bloco.<código>}}'}.
          </p>
          <MarkerText
            value={value.behavior}
            rows={8}
            mono
            markers={availableMarkers(content, { kind: 'behavior' })}
            disabled={disabled}
            onChange={(behavior) => onChange({ ...value, behavior })}
          />
        </div>
      )}
      {tab === 'actions' && (
        <IntentionList
          content={content}
          intentions={value.intentions}
          issues={() => []}
          disabled={disabled}
          onChange={(intentions) => onChange({ ...value, intentions })}
        />
      )}
      {tab === 'json' && (
        <JsonTab
          value={value}
          schema={functionBlockContentSchema}
          disabled={disabled}
          onChange={onChange}
        />
      )}
      {footer}
    </div>
  );
}
