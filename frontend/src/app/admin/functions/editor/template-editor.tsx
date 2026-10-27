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
import {
  type ComponentType,
  type ReactNode,
  type SVGProps,
  useDeferredValue,
  useMemo,
  useState,
} from 'react';
import type { z } from 'zod';
import {
  AlertIcon,
  BoltIcon,
  BuildingIcon,
  CheckIcon,
  CodeIcon,
  DatabaseIcon,
  EyeIcon,
  HistoryIcon,
  LayersIcon,
  ListIcon,
  SlidersIcon,
  TextIcon,
} from '@/components/icons';
import { Switch } from '@/components/ui';
import { Field, inputClass } from '../../../app/agents/agent-fields';
import { checkJson } from './json';
import { type FieldContext, FieldList, type Rename } from './field-editor';
import { FocusContext, type FocusTarget } from './focus';
import { IntentionList } from './intention-editor';
import { KIND_STYLE, Section, Segmented, SettingRow, TriState, TypeIcon } from './kit';
import { MarkerText } from './marker-text';
import { TransferList } from './transfer-editor';
import { allIds, KIND_LABELS, type Published, renameId, renameOption } from './model';
import { CompiledBehavior, PreviewTab } from './preview-tab';

type Tab = 'general' | 'form' | 'behavior' | 'actions' | 'preview' | 'versions' | 'json';

const TAB_LABELS: Record<Tab, string> = {
  general: 'Geral',
  form: 'Formulário',
  behavior: 'Texto do agente',
  actions: 'Ações',
  preview: 'Testar',
  versions: 'Versões',
  json: 'JSON',
};

const TAB_ICONS: Record<Tab, ComponentType<SVGProps<SVGSVGElement>>> = {
  general: SlidersIcon,
  form: ListIcon,
  behavior: TextIcon,
  actions: BoltIcon,
  preview: EyeIcon,
  versions: HistoryIcon,
  json: CodeIcon,
};

/** O que se faz em cada seção: aparece abaixo do título. */
const TAB_HINTS: Record<Tab, string> = {
  general: 'Nome, tipo do agente, configurações e blocos compartilhados que a função inclui.',
  form: 'As perguntas que o cliente responde, na ordem em que ele vê.',
  behavior:
    'O texto que o agente segue. Cada resposta entra no seu marcador {{…}}; numa escolha, entra o texto da opção.',
  actions: 'O que o agente faz no Bitrix24 e quando.',
  preview:
    'Responda como um cliente e veja o agente que sai. Atualiza enquanto você edita, sem salvar.',
  versions: 'Cada publicação vira uma versão imutável. Compare ou restaure uma anterior.',
  json: 'O mesmo conteúdo em JSON, para o que as outras seções não cobrem.',
};

const SECTION_TAB: Record<TemplateIssue['where']['section'], Tab> = {
  general: 'general',
  form: 'form',
  behavior: 'behavior',
  actions: 'actions',
};

const DERIVED: Array<[keyof AgentSettings, string, string]> = [
  ['enabledHumanTransfer', 'Transferência para atendente', 'O agente pode passar a conversa.'],
  ['limitSubjects', 'Falar só dos assuntos do negócio', 'Recusa temas fora do negócio.'],
  ['knowledgeByFunction', 'Busca inteligente na base', 'Procura na base pela função.'],
];

const AGENT_TYPES: Array<{
  value: FunctionTemplateDraft['agentType'];
  label: string;
  hint: string;
}> = [
  { value: 'SALE', label: 'Vendas', hint: 'Prospecção e qualificação' },
  { value: 'SUPPORT', label: 'Suporte', hint: 'Atendimento e dúvidas' },
  { value: 'PERSONAL', label: 'Pessoal', hint: 'Assistente geral' },
];

/** Abas em pílulas (editor de blocos). */
function PillTabs({ tab, onTab, tabs }: { tab: Tab; onTab: (tab: Tab) => void; tabs: Tab[] }) {
  return (
    <nav className="inline-flex gap-1 rounded-xl bg-zinc-100 p-1" role="tablist">
      {tabs.map((key) => {
        const Icon = TAB_ICONS[key];
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => onTab(key)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === key ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <Icon className="size-4" />
            {TAB_LABELS[key]}
          </button>
        );
      })}
    </nav>
  );
}

/** Navegação lateral do editor, com contagem de itens e de problemas por seção. */
function SideNav({
  tab,
  onTab,
  groups,
  counts,
  sizes,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  groups: Array<{ title: string; tabs: Tab[] }>;
  counts: Partial<Record<Tab, number>>;
  sizes: Partial<Record<Tab, number>>;
}) {
  return (
    <nav
      className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:gap-5 lg:overflow-visible lg:pb-0"
      role="tablist"
      aria-orientation="vertical"
    >
      {groups.map((group) => (
        <div key={group.title} className="flex gap-1 lg:flex-col lg:gap-0.5">
          <p className="hidden px-3 pb-1 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase lg:block">
            {group.title}
          </p>
          {group.tabs.map((key) => {
            const Icon = TAB_ICONS[key];
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onTab(key)}
                className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-white text-brand-700 shadow-sm ring-1 ring-zinc-200'
                    : 'text-zinc-600 hover:bg-white/70 hover:text-zinc-900'
                }`}
              >
                <Icon className={`size-4 ${active ? 'text-brand-600' : 'text-zinc-400'}`} />
                <span className="flex-1 text-left whitespace-nowrap">{TAB_LABELS[key]}</span>
                {counts[key] ? (
                  <span className="rounded-full bg-red-500 px-1.5 text-[11px] leading-4.5 font-semibold text-white">
                    {counts[key]}
                  </span>
                ) : sizes[key] !== undefined ? (
                  <span className="text-xs text-zinc-400 tabular-nums">{sizes[key]}</span>
                ) : null}
              </button>
            );
          })}
        </div>
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
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2 text-xs">
        <span className="font-mono text-zinc-400">rascunho.json</span>
        {check.errors.length > 0 ? (
          <span className="text-red-400">{check.errors.length} erro(s)</span>
        ) : (
          <span className="flex items-center gap-1 text-emerald-400">
            <CheckIcon className="size-3.5" /> Estrutura válida
          </span>
        )}
      </div>
      <textarea
        className="block min-h-[32rem] w-full resize-y bg-transparent p-4 font-mono text-xs leading-relaxed text-zinc-100 focus:outline-none disabled:text-zinc-400"
        spellCheck={false}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = checkJson(e.target.value, schema);
          if (parsed.value) onChange(parsed.value);
        }}
      />
      {check.errors.length > 0 && (
        <ul className="max-h-40 space-y-0.5 overflow-auto border-t border-zinc-800 px-4 py-2 text-xs text-red-300">
          {check.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
          <li className="text-zinc-500">As outras seções seguem com o último conteúdo válido.</li>
        </ul>
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

/** Painel de saúde: tamanho máximo do texto e problemas, com atalho para o lugar (spec D12). */
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
  const ratio = Math.min(1, budget.length / FUNCTION_BEHAVIOR_MAX);
  const top = Object.entries(budget.markers)
    .filter(([, length]) => length > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6);
  const bar = over ? 'bg-red-500' : budget.length > 2900 ? 'bg-amber-500' : 'bg-brand-500';
  return (
    <div className="space-y-4">
      {problems.length === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
            <CheckIcon className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-emerald-900">Pronto para publicar</p>
            <p className="text-xs text-emerald-700">Nenhum problema encontrado.</p>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-red-200 bg-white">
          <div className="flex items-center gap-3 border-b border-red-100 bg-red-50/60 px-4 py-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-red-500 text-white">
              <AlertIcon className="size-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-red-900">
                {problems.length === 1 ? '1 problema' : `${problems.length} problemas`}
              </p>
              <p className="text-xs text-red-700">Impedem testar e publicar.</p>
            </div>
          </div>
          <ul className="max-h-72 divide-y divide-zinc-100 overflow-auto">
            {problems.map((problem, index) => (
              <li key={index}>
                <button
                  type="button"
                  className="block w-full px-4 py-2.5 text-left hover:bg-zinc-50"
                  onClick={() => onGo(problem)}
                >
                  <span className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
                    {TAB_LABELS[problem.tab]}
                  </span>
                  <span className="block text-xs text-zinc-700">{problem.message}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-xs">
        <p
          className="text-xs font-medium text-zinc-500"
          title="Com todas as respostas no limite e a opção de texto mais longo em cada escolha"
        >
          Tamanho máximo do texto
        </p>
        <p className="mt-1 flex items-baseline gap-1">
          <span
            className={`text-2xl font-semibold tabular-nums ${over ? 'text-red-600' : 'text-zinc-900'}`}
          >
            {budget.length.toLocaleString('pt-BR')}
          </span>
          <span className="text-sm text-zinc-400">
            / {FUNCTION_BEHAVIOR_MAX.toLocaleString('pt-BR')}
          </span>
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100">
          <div className={`h-full rounded-full ${bar}`} style={{ width: `${ratio * 100}%` }} />
        </div>
        <p className="mt-3 text-xs text-zinc-500">Com todas as respostas no limite. O que pesa:</p>
        <ul className="mt-2 space-y-2 text-xs">
          {[
            ['Texto fixo', budget.fixed, undefined] as const,
            ...top.map(([path, length]) => [labels.get(path) ?? path, length, path] as const),
          ].map(([label, length, path]) => (
            <li key={path ?? '_fixed'}>
              <div className="flex justify-between gap-2 text-zinc-600">
                <span className="truncate" title={path ? `{{${path}}}` : undefined}>
                  {label}
                </span>
                <span className="tabular-nums">{length}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full bg-zinc-300"
                  style={{ width: `${Math.min(1, length / FUNCTION_BEHAVIOR_MAX) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
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
  identity,
  availability,
  versions,
  progress,
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
  /** Nome e descrição da função: primeira seção de Geral. */
  identity: ReactNode;
  /** Portais em que a função aparece: seção de Geral logo após a identidade (só funções). */
  availability?: ReactNode;
  /** Lista de versões publicadas (seção Versões). */
  versions: { count: number; content: ReactNode };
  /** Andamento editar → testar → publicar, no topo do painel lateral. */
  progress?: ReactNode;
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
  const sectionErrors = (section: 'general' | 'behavior') =>
    find.section(section).map((message) => (
      <p key={message} className="text-xs text-red-600">
        {message}
      </p>
    ));

  return (
    <FocusContext.Provider value={focus}>
      <div className="grid gap-6 lg:grid-cols-[12.5rem_minmax(0,1fr)] xl:grid-cols-[12.5rem_minmax(0,1fr)_19rem]">
        <aside className="lg:sticky lg:top-24 lg:row-span-2 lg:self-start">
          <SideNav
            tab={tab}
            onTab={switchTab}
            counts={counts}
            sizes={{
              form: draft.fields.length,
              actions: draft.intentions.length,
              versions: versions.count,
            }}
            groups={[
              { title: 'Montar', tabs: ['general', 'form', 'behavior', 'actions'] },
              { title: 'Validar', tabs: ['preview', 'versions', 'json'] },
            ]}
          />
        </aside>

        <aside className="space-y-4 lg:col-start-2 xl:sticky xl:top-24 xl:col-start-3 xl:row-start-1 xl:self-start">
          {progress}
          <CheckPanel
            check={live.check}
            problems={templateProblems(live)}
            labels={labels}
            onGo={go}
          />
        </aside>

        <div className="min-w-0 space-y-5 lg:col-start-2 xl:row-start-1">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
                {TAB_LABELS[tab]}
              </h2>
              <p className="mt-0.5 text-sm text-zinc-500">{TAB_HINTS[tab]}</p>
            </div>
            {tab === 'behavior' && (
              <Segmented
                label="Visualização"
                value={sideBySide ? 'split' : 'editor'}
                options={[
                  { value: 'editor', label: 'Só o editor' },
                  { value: 'split', label: 'Lado a lado' },
                ]}
                onChange={(value) => setSideBySide(value === 'split')}
              />
            )}
          </div>

          {tab === 'general' && (
            <div className="space-y-5">
              <Section title="Identidade" description="Como a função aparece para o cliente.">
                {identity}
              </Section>

              {availability}

              <Section title="Tipo do agente no GPTMaker">
                <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
                  {AGENT_TYPES.map((type) => {
                    const active = draft.agentType === type.value;
                    return (
                      <button
                        key={type.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        disabled={disabled}
                        onClick={() => set({ agentType: type.value })}
                        className={`rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed ${
                          active
                            ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500'
                            : 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50'
                        }`}
                      >
                        <span className="flex items-center justify-between">
                          <span
                            className={`text-sm font-semibold ${active ? 'text-brand-700' : 'text-zinc-900'}`}
                          >
                            {type.label}
                          </span>
                          {active && (
                            <span className="flex size-4 items-center justify-center rounded-full bg-brand-600 text-white">
                              <CheckIcon className="size-3" />
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs text-zinc-500">{type.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </Section>

              <Section
                title="Configurações do agente"
                description="“Padrão” deixa como o agente já está; as opções do formulário podem mudar."
              >
                <div className="divide-y divide-zinc-100">
                  {DERIVED.map(([key, label, hint]) => (
                    <SettingRow key={key} title={label} description={hint}>
                      <TriState
                        label={label}
                        disabled={disabled}
                        value={draft.settings[key] as boolean | undefined}
                        onChange={(value) => {
                          const settings = { ...draft.settings } as Record<string, unknown>;
                          if (value === undefined) delete settings[key];
                          else settings[key] = value;
                          set({ settings: settings as AgentSettings });
                        }}
                      />
                    </SettingRow>
                  ))}
                  <div className="pt-3">
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
                </div>
              </Section>

              <Section
                title="Blocos incluídos"
                icon={LayersIcon}
                description="Campos, texto e ações compartilhados entre as funções."
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  {[...blocks].map(([code, block]) => {
                    const checked = draft.blocks.includes(code);
                    return (
                      <label
                        key={code}
                        className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                          checked
                            ? 'border-brand-400 bg-brand-50/50'
                            : 'border-zinc-200 hover:border-zinc-300'
                        } ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 accent-brand-600"
                          checked={checked}
                          disabled={disabled}
                          onChange={(e) =>
                            set({
                              blocks: e.target.checked
                                ? [...draft.blocks, code]
                                : draft.blocks.filter((c) => c !== code),
                            })
                          }
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-zinc-900">
                            {block.name}
                          </span>
                          <span className="mt-0.5 block text-xs text-zinc-500">
                            {block.content.fields.length} pergunta(s) ·{' '}
                            {block.content.intentions.length} ação(ões)
                            {block.content.crmAccess && ' · usa o CRM'}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {live.blockErrors.map((error) => (
                  <p key={error} className="mt-2 text-xs text-red-600">
                    {error}
                  </p>
                ))}
              </Section>

              <Section title="Acesso ao CRM" icon={DatabaseIcon}>
                <CrmAccessToggle
                  checked={draft.crmAccess}
                  disabled={disabled}
                  onChange={(crmAccess) => set({ crmAccess })}
                  requiredBy={draft.blocks.flatMap((code) => {
                    const block = blocks.get(code);
                    return block?.content.crmAccess ? [block.name] : [];
                  })}
                />
              </Section>

              <Section
                title="Dados da empresa enviados ao GPTMaker"
                icon={BuildingIcon}
                description="Use marcadores para trazer as respostas do formulário."
              >
                <div className="space-y-4">
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
                  {sectionErrors('general')}
                </div>
              </Section>
            </div>
          )}

          {tab === 'form' && (
            <div className="space-y-4">
              {blockFields.length > 0 && (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-600">
                    <LayersIcon className="size-3.5" />
                    Vêm dos blocos incluídos (edite em Blocos compartilhados)
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {blockFields.map(({ code, field }) => {
                      const style = KIND_STYLE[field.kind];
                      return (
                        <li
                          key={`${code}:${field.id}`}
                          className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white py-1 pr-2.5 pl-1 text-xs text-zinc-700"
                          title={KIND_LABELS[field.kind]}
                        >
                          <TypeIcon icon={style.icon} tone={style.tone} size="sm" />
                          {field.label}
                        </li>
                      );
                    })}
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
            <div className={sideBySide ? 'grid gap-4 2xl:grid-cols-2' : ''}>
              <div className="min-w-0 rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-xs">
                <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                  Modelo
                </p>
                <MarkerText
                  value={draft.behavior}
                  rows={28}
                  mono
                  markers={markers}
                  disabled={disabled}
                  onChange={(behavior) => set({ behavior })}
                />
                {sectionErrors('behavior')}
              </div>
              {sideBySide && (
                <div className="min-w-0 rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-xs">
                  <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                    Resultado
                  </p>
                  {preview.compiled ? (
                    <CompiledBehavior behavior={preview.compiled.behavior} />
                  ) : (
                    <p className="text-xs text-red-600">O rascunho ainda não compila.</p>
                  )}
                  <p className="mt-2 text-xs text-zinc-500">
                    Com as respostas da seção{' '}
                    <button
                      type="button"
                      className="font-medium text-brand-700 hover:underline"
                      onClick={() => switchTab('preview')}
                    >
                      Testar
                    </button>
                    {Object.keys(answers).length === 0 && ' (ainda vazias: preencha um exemplo lá)'}
                  </p>
                </div>
              )}
            </div>
          )}

          {tab === 'actions' && (
            <div className="space-y-8">
              <IntentionList
                content={{ fields: live.content.fields, intentions: draft.intentions }}
                intentions={draft.intentions}
                issues={find.intention}
                published={publishedIntentions}
                disabled={disabled}
                onChange={(intentions) => set({ intentions })}
              />
              <TransferList
                content={{ fields: live.content.fields, intentions: draft.intentions }}
                transfers={draft.transfers ?? []}
                issues={(key) => find.intention(key)}
                disabled={disabled}
                onChange={(transfers) => set({ transfers })}
              />
            </div>
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

          {tab === 'versions' && versions.content}

          {tab === 'json' && (
            <JsonTab
              value={draft}
              schema={functionTemplateDraftSchema}
              disabled={disabled}
              onChange={onChange}
            />
          )}
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
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-zinc-800">Exige acesso ao CRM</p>
        <p className="mt-0.5 text-xs text-zinc-500">
          Ao publicar a função num agente, o acesso ao CRM dele é ativado (ação &quot;
          {CRM_SYSTEM_INTENTION_NAME}&quot; e consultas ao CRM). Para usar no texto, cite a ação
          pelo nome.
          {requiredBy.length > 0 && <> Exigido pelo bloco {requiredBy.join(', ')}.</>}
        </p>
      </div>
      <Switch
        label="Exige acesso ao CRM"
        checked={checked || requiredBy.length > 0}
        disabled={disabled || requiredBy.length > 0}
        onChange={onChange}
      />
    </div>
  );
}

/** Editor visual de um bloco compartilhado: formulário, texto e ações, sem checagem de orçamento. */
export function BlockEditor({
  value,
  onChange,
  prefix,
  disabled,
}: {
  value: FunctionBlockContent;
  onChange: (value: FunctionBlockContent) => void;
  prefix: string;
  disabled?: boolean;
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
    <div className="space-y-5">
      <div className="rounded-xl border border-zinc-200 p-4">
        <CrmAccessToggle
          checked={value.crmAccess}
          disabled={disabled}
          onChange={(crmAccess) => onChange({ ...value, crmAccess })}
        />
      </div>
      <PillTabs tab={tab} onTab={setTab} tabs={['form', 'behavior', 'actions', 'json']} />
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
        <div className="space-y-8">
          <IntentionList
            content={content}
            intentions={value.intentions}
            issues={() => []}
            disabled={disabled}
            onChange={(intentions) => onChange({ ...value, intentions })}
          />
          <TransferList
            content={content}
            transfers={value.transfers ?? []}
            issues={() => []}
            disabled={disabled}
            onChange={(transfers) => onChange({ ...value, transfers })}
          />
        </div>
      )}
      {tab === 'json' && (
        <JsonTab
          value={value}
          schema={functionBlockContentSchema}
          disabled={disabled}
          onChange={onChange}
        />
      )}
    </div>
  );
}
