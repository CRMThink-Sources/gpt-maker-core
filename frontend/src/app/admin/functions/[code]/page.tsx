'use client';

import {
  type AdminFunctionBlockView,
  type AdminFunctionTemplateView,
  type AdminFunctionVersionView,
  collapseBlocks,
  diffLines,
  type DiffLine,
  expandBlocks,
  type FunctionAnswers,
  type FunctionBlockContent,
  type FunctionTemplateContent,
  type FunctionTemplateDraft,
  functionTemplateDraftSchema,
  type FunctionVersionDiff,
  flattenFields,
  stableStringify,
} from '@gptmaker/contracts';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckIcon,
  ChevronRightIcon,
  FlaskIcon,
  HistoryIcon,
  RedoIcon,
  RocketIcon,
  SaveIcon,
  UndoIcon,
} from '@/components/icons';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Loading } from '@/components/ui';
import { Field, inputClass } from '../../../app/agents/agent-fields';
import { BehaviorDiff } from '../../../app/agents/function-preview';
import { useAdmin, useOperator } from '../../admin-provider';
import { Menu } from '../editor/kit';
import { TemplateEditor, templateProblems, useLiveTemplate } from '../editor/template-editor';
import { message } from '../shared';

type Blocks = Map<string, { name: string; content: FunctionBlockContent }>;

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Edições seguidas dentro deste intervalo viram um passo só do desfazer (digitação). */
const UNDO_GROUP_MS = 800;
const UNDO_LIMIT = 50;

/** Rascunho, teste, publicação e versões de uma função (spec agent-function-templates). */
export default function AdminFunctionPage() {
  const { code } = useParams<{ code: string }>();
  const { api } = useAdmin();
  const [loaded, setLoaded] = useState<{ view: AdminFunctionTemplateView; blocks: Blocks } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const base = `/admin/functions/${encodeURIComponent(code)}`;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<AdminFunctionTemplateView>(base),
      api<AdminFunctionBlockView[]>('/admin/function-blocks'),
    ])
      .then(([view, list]) => {
        if (cancelled) return;
        const blocks: Blocks = new Map(
          list.flatMap((block) =>
            block.content
              ? [[block.code, { name: block.name, content: block.content }] as const]
              : [],
          ),
        );
        setLoaded({ view, blocks });
      })
      .catch(
        (e: unknown) => !cancelled && setError(message(e, 'Não foi possível carregar a função.')),
      );
    return () => {
      cancelled = true;
    };
  }, [api, base]);

  if (!loaded) return error ? <Alert tone="error">{error}</Alert> : <Loading />;
  return <FunctionEditor key={code} base={base} initial={loaded.view} blocks={loaded.blocks} />;
}

/** Passos do fluxo: editar sem problemas, testar no sandbox, publicar. */
function Steps({
  problems,
  tested,
  nextVersion,
}: {
  problems: number;
  tested: boolean;
  nextVersion: number;
}) {
  const steps = [
    {
      label: 'Editar',
      done: problems === 0,
      detail:
        problems === 0 ? 'sem problemas' : problems === 1 ? '1 problema' : `${problems} problemas`,
    },
    {
      label: 'Testar',
      done: tested,
      detail: tested ? 'testado no sandbox' : 'seção Testar e sandbox',
    },
    { label: 'Publicar', done: false, detail: `cria a v${nextVersion}` },
  ];
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-xs">
      <p className="text-xs font-medium text-zinc-500">Caminho até publicar</p>
      <ol className="mt-3 space-y-0">
        {steps.map((step, index) => (
          <li key={step.label} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  step.done
                    ? 'bg-emerald-500 text-white'
                    : 'bg-white text-zinc-500 ring-1 ring-zinc-300'
                }`}
              >
                {step.done ? <CheckIcon className="size-3.5" /> : index + 1}
              </span>
              {index < steps.length - 1 && (
                <span
                  className={`my-1 w-px flex-1 ${step.done ? 'bg-emerald-300' : 'bg-zinc-200'}`}
                />
              )}
            </div>
            <div className={index < steps.length - 1 ? 'pb-4' : ''}>
              <p className="text-sm font-medium text-zinc-900">{step.label}</p>
              <p
                className={`text-xs ${step.label === 'Editar' && !step.done ? 'text-red-600' : 'text-zinc-500'}`}
              >
                {step.detail}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Pergunta ou ação: o id distingue rótulos repetidos (ex.: dois "Funil e etapa"). */
interface Change {
  id: string;
  label: string;
}

/** O que a publicação muda em relação à versão atual. */
interface PublishSummary {
  /** Nula na primeira publicação. */
  from: number | null;
  behavior: DiffLine[];
  fields: { added: Change[]; removed: Change[] };
  intentions: { added: Change[]; removed: Change[] };
}

function summarize(
  before: FunctionTemplateContent | null,
  after: FunctionTemplateContent,
  from: number | null,
): PublishSummary {
  const fieldsOf = (content: FunctionTemplateContent | null) =>
    new Map(flattenFields(content?.fields ?? []).map((f) => [f.id, f.label]));
  const intentionsOf = (content: FunctionTemplateContent | null) =>
    new Map((content?.intentions ?? []).map((i) => [i.key, i.name]));
  const diff = (a: Map<string, string>, b: Map<string, string>) => ({
    added: [...b].filter(([id]) => !a.has(id)).map(([id, label]) => ({ id, label })),
    removed: [...a].filter(([id]) => !b.has(id)).map(([id, label]) => ({ id, label })),
  });
  return {
    from,
    behavior: diffLines(before?.behavior ?? '', after.behavior),
    fields: diff(fieldsOf(before), fieldsOf(after)),
    intentions: diff(intentionsOf(before), intentionsOf(after)),
  };
}

function ChangeList({
  title,
  items,
  tone,
}: {
  title: string;
  items: Change[];
  tone: 'green' | 'amber';
}) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="text-zinc-600">{title}:</span>
      {items.map((item) => (
        <Badge key={item.id} tone={tone}>
          {item.label}
        </Badge>
      ))}
    </div>
  );
}

function FunctionEditor({
  base,
  initial,
  blocks,
}: {
  base: string;
  initial: AdminFunctionTemplateView;
  blocks: Blocks;
}) {
  const { api } = useAdmin();
  const isAdmin = useOperator().role === 'ADMIN';
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [draft, setDraft] = useState<FunctionTemplateDraft>(initial.draft);
  const [saved, setSaved] = useState(() => JSON.stringify(initial.draft));
  const [history, setHistory] = useState<{
    past: FunctionTemplateDraft[];
    future: FunctionTemplateDraft[];
  }>({ past: [], future: [] });
  const lastEdit = useRef(0);
  const [answers, setAnswers] = useState<FunctionAnswers>({});
  const [agentName, setAgentName] = useState('Ana');
  // Rascunho (JSON) que foi para o sandbox: o passo Testar vale enquanto o rascunho for o mesmo.
  const [tested, setTested] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<PublishSummary | null>(null);
  const [diff, setDiff] = useState<FunctionVersionDiff | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Depois de restaurar: versão publicada e, se der para montar, o rascunho que a reproduz.
  const [restored, setRestored] = useState<{
    version: number;
    draft: FunctionTemplateDraft | null;
  } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const live = useLiveTemplate(draft, blocks);
  const problems = templateProblems(live).length;
  const current = JSON.stringify(draft);
  const dirty = current !== saved || name !== view.name || description !== view.description;
  const nextVersion = (view.latestVersion ?? 0) + 1;

  const show = useCallback((next: AdminFunctionTemplateView) => {
    setView(next);
    setName(next.name);
    setDescription(next.description);
    setDraft(next.draft);
    setSaved(JSON.stringify(next.draft));
  }, []);

  /** Edição do rascunho: guarda o estado anterior para desfazer (digitação seguida é um passo). */
  function edit(next: FunctionTemplateDraft) {
    const now = Date.now();
    const group = now - lastEdit.current < UNDO_GROUP_MS;
    lastEdit.current = now;
    setHistory((h) => ({
      past: group ? h.past : [...h.past.slice(-(UNDO_LIMIT - 1)), draft],
      future: [],
    }));
    setDraft(next);
  }

  function undo() {
    const previous = history.past.at(-1);
    if (!previous) return;
    lastEdit.current = 0;
    setHistory({ past: history.past.slice(0, -1), future: [draft, ...history.future] });
    setDraft(previous);
  }

  function redo() {
    const [next, ...rest] = history.future;
    if (!next) return;
    lastEdit.current = 0;
    setHistory({ past: [...history.past, draft], future: rest });
    setDraft(next);
  }

  /** Executa uma ação; erro de publicação traz a lista de problemas do rascunho. */
  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    setErrors([]);
    try {
      await action();
    } catch (e) {
      setError(message(e, fallback));
      const details = (
        e as {
          details?: { errors?: string[]; fields?: Array<{ id: string; from: string; to: string }> };
        }
      ).details;
      if (details?.errors) setErrors(details.errors);
      if (details?.fields) {
        setErrors(
          details.fields.map(
            (field) => `${field.id}: publicado como ${field.from}, não pode virar ${field.to}`,
          ),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  /** Grava o rascunho como está no editor (o servidor valida de novo). */
  async function persist(value = draft): Promise<AdminFunctionTemplateView> {
    const parsed = functionTemplateDraftSchema.safeParse(value);
    if (!parsed.success)
      throw new Error('O rascunho tem campos incompletos: veja os problemas no painel ao lado.');
    const next = await api<AdminFunctionTemplateView>(`${base}/draft`, {
      method: 'PUT',
      body: JSON.stringify({ name, description, draft: parsed.data }),
    });
    show(next);
    return next;
  }

  const saveDraft = () =>
    run(async () => {
      await persist();
      setNotice(
        'Rascunho salvo. Nenhum agente muda até a função ser publicada e o agente republicado.',
      );
    }, 'Não foi possível salvar o rascunho.');

  const sandbox = () =>
    run(async () => {
      // O sandbox compila o rascunho salvo: grava antes, se houver alteração.
      const snapshot = dirty ? JSON.stringify((await persist()).draft) : current;
      const result = await api<{ gptmakerAgentId: string }>(`${base}/sandbox`, {
        method: 'POST',
        body: JSON.stringify({ answers, agentName }),
      });
      setTested(snapshot);
      setNotice(
        `Publicado no agente de sandbox (${result.gptmakerAgentId}) com as respostas da aba Testar. Converse com ele pelo painel do GPTMaker.`,
      );
    }, 'Não foi possível publicar no sandbox.');

  /** Abre a confirmação com o que muda em relação à versão atual. */
  const reviewPublish = () =>
    run(async () => {
      const latest = view.latestVersion
        ? await api<AdminFunctionVersionView>(`${base}/versions/${view.latestVersion}`)
        : null;
      setPublishing(summarize(latest?.content ?? null, live.content, view.latestVersion));
    }, 'Não foi possível comparar com a versão atual.');

  const publish = () =>
    run(async () => {
      // Publica o que está no editor: grava antes, se houver alteração.
      if (dirty) await persist();
      show(await api<AdminFunctionTemplateView>(`${base}/publish`, { method: 'POST' }));
      setPublishing(null);
      setRestored(null);
      setHistory({ past: [], future: [] });
      setNotice('Versão publicada. Os agentes recebem o aviso e mudam quando republicarem.');
    }, 'Não foi possível publicar.');

  const restore = (version: number) =>
    run(async () => {
      const next = await api<AdminFunctionTemplateView>(`${base}/versions/${version}/restore`, {
        method: 'POST',
      });
      show(next);
      setHistory({ past: [], future: [] });
      // O servidor troca o rascunho pelo da versão restaurada; quando não consegue (um bloco mudou
      // depois dela), o rascunho fica e publicar de novo levaria as diferenças sem o operador
      // perceber.
      const latest = await api<AdminFunctionVersionView>(`${base}/versions/${next.latestVersion}`);
      const contents = new Map([...blocks].map(([code, block]) => [code, block.content]));
      const { content } = expandBlocks(next.draft, contents);
      const same = stableStringify(content) === stableStringify(latest.content);
      setNotice(
        `Conteúdo da versão ${version} publicado como v${next.latestVersion}.${same ? ' O rascunho também voltou a ela.' : ''}`,
      );
      setRestored(
        same
          ? null
          : {
              version: latest.version,
              draft: collapseBlocks(latest.content, next.draft, contents),
            },
      );
    }, 'Não foi possível restaurar.');

  /** Troca o rascunho pelo que reproduz a versão restaurada e grava. */
  const discardDraft = (value: FunctionTemplateDraft) =>
    run(async () => {
      await persist(value);
      setRestored(null);
      setHistory({ past: [], future: [] });
      setNotice('Rascunho descartado: agora é igual à versão publicada.');
    }, 'Não foi possível descartar o rascunho.');

  const toggleActive = () =>
    run(async () => {
      const next = await api<AdminFunctionTemplateView>(
        `${base}/${view.active ? 'inactivate' : 'activate'}`,
        { method: 'POST' },
      );
      setView(next);
      setNotice(
        next.active
          ? 'Função reativada: volta a aparecer na criação de agentes.'
          : 'Função inativada: some da criação de agentes; os agentes que a usam seguem normais.',
      );
    }, 'Não foi possível alterar a função.');

  const remove = () =>
    run(async () => {
      await api(base, { method: 'DELETE' });
      router.push('/admin/functions');
    }, 'Não foi possível excluir a função.');

  const openDiff = (version: number) =>
    run(async () => {
      setDiff(await api<FunctionVersionDiff>(`${base}/versions/${version - 1}/diff/${version}`));
    }, 'Não foi possível comparar as versões.');

  // Atalhos: Ctrl+S salva; Ctrl+Z / Ctrl+Shift+Z (ou Ctrl+Y) desfazem fora dos campos de texto,
  // que têm o próprio desfazer.
  const keys = useRef({ save: () => {}, undo: () => {}, redo: () => {} });
  useEffect(() => {
    keys.current = {
      save: () => {
        if (isAdmin && !busy) void saveDraft();
      },
      undo,
      redo,
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        keys.current.save();
        return;
      }
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        keys.current.undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        keys.current.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Fechar ou recarregar a aba com alteração não salva pede confirmação.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const publishBlocked = problems > 0 || !live.check;

  const versionList =
    view.versions.length === 0 ? (
      <div className="rounded-2xl border border-dashed border-zinc-200 bg-white px-6 py-12 text-center">
        <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <HistoryIcon className="size-5" />
        </span>
        <p className="mt-3 text-sm font-medium text-zinc-800">Nenhuma versão publicada</p>
        <p className="mt-0.5 text-xs text-zinc-500">
          Publique a função para os clientes poderem usá-la.
        </p>
      </div>
    ) : (
      <ol className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-xs">
        {view.versions.map((version, index) => {
          const current = version.version === view.latestVersion;
          return (
            <li key={version.version} className="flex gap-4">
              <div className="flex flex-col items-center">
                <span
                  className={`mt-1 size-3 shrink-0 rounded-full ring-4 ${
                    current ? 'bg-brand-600 ring-brand-100' : 'bg-zinc-300 ring-zinc-100'
                  }`}
                />
                {index < view.versions.length - 1 && (
                  <span className="my-1 w-px flex-1 bg-zinc-200" />
                )}
              </div>
              <div
                className={`flex min-w-0 flex-1 flex-wrap items-start gap-3 ${index < view.versions.length - 1 ? 'pb-6' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                    Versão {version.version}
                    {current && <Badge tone="brand">atual</Badge>}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {dateTime(version.publishedAt)} · {version.publishedBy ?? 'seed'} ·{' '}
                    {version.agents === 1 ? '1 agente' : `${version.agents} agentes`}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {version.version > 1 && (
                    <button
                      type="button"
                      className={buttonClass('ghost', 'sm')}
                      disabled={busy}
                      onClick={() => openDiff(version.version)}
                    >
                      Ver mudanças
                    </button>
                  )}
                  {isAdmin && !current && (
                    <button
                      type="button"
                      className={buttonClass('secondary', 'sm')}
                      disabled={busy}
                      onClick={() => restore(version.version)}
                    >
                      Restaurar
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    );

  return (
    <>
      <div className="sticky top-0 z-20 -mx-4 mb-6 border-b border-zinc-200/80 bg-zinc-50/85 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1">
            <nav className="flex items-center gap-1 text-xs text-zinc-500">
              <Link href="/admin/functions" className="hover:text-zinc-800">
                Funções
              </Link>
              <ChevronRightIcon className="size-3" />
              <span className="font-mono">{view.code}</span>
            </nav>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight text-zinc-900">
                {name || view.name}
              </h1>
              {view.latestVersion ? (
                <Badge tone="green">v{view.latestVersion} publicada</Badge>
              ) : (
                <Badge tone="amber">nunca publicada</Badge>
              )}
              {!view.active && <Badge tone="zinc">inativa</Badge>}
              <span className="text-xs text-zinc-500">
                {view.agents === 1 ? '1 agente usa' : `${view.agents} agentes usam`}
              </span>
              {dirty && (
                <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
                  <span className="size-1.5 rounded-full bg-amber-500" />
                  Não salvo
                </span>
              )}
            </div>
          </div>
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-zinc-200 bg-white shadow-xs">
                <button
                  type="button"
                  className="inline-flex size-9 items-center justify-center rounded-l-lg text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800 disabled:opacity-40"
                  disabled={!history.past.length}
                  title="Desfazer (Ctrl+Z)"
                  aria-label="Desfazer"
                  onClick={undo}
                >
                  <UndoIcon className="size-4" />
                </button>
                <button
                  type="button"
                  className="inline-flex size-9 items-center justify-center rounded-r-lg border-l border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800 disabled:opacity-40"
                  disabled={!history.future.length}
                  title="Refazer (Ctrl+Shift+Z)"
                  aria-label="Refazer"
                  onClick={redo}
                >
                  <RedoIcon className="size-4" />
                </button>
              </div>
              <button
                type="button"
                className={buttonClass('secondary')}
                disabled={busy || !dirty}
                title="Ctrl+S"
                onClick={saveDraft}
              >
                <SaveIcon className="size-4" />
                Salvar
              </button>
              <button
                type="button"
                className={buttonClass('secondary')}
                disabled={busy || publishBlocked}
                title={
                  publishBlocked
                    ? 'Resolva os problemas antes de testar'
                    : 'Publica no agente de sandbox com as respostas da seção Testar'
                }
                onClick={sandbox}
              >
                <FlaskIcon className="size-4" />
                Testar no sandbox
              </button>
              <button
                type="button"
                className={buttonClass('primary')}
                disabled={busy || publishBlocked}
                title={publishBlocked ? 'Resolva os problemas antes de publicar' : undefined}
                onClick={reviewPublish}
              >
                <RocketIcon className="size-4" />
                Publicar v{nextVersion}
              </button>
              <Menu
                items={[
                  {
                    label: view.active ? 'Inativar função' : 'Reativar função',
                    onClick: toggleActive,
                    disabled: busy,
                  },
                  {
                    label: 'Excluir função',
                    danger: true,
                    disabled: busy || view.agents > 0,
                    title:
                      view.agents > 0 ? 'Usada por agentes: inative em vez de excluir' : undefined,
                    onClick: () => setConfirmDelete(true),
                  },
                ]}
              />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {(error || errors.length > 0 || notice || restored) && (
          <div className="space-y-3">
            {error && <Alert tone="error">{error}</Alert>}
            {errors.length > 0 && (
              <Alert tone="error">
                <ul className="list-disc space-y-0.5 pl-4">
                  {errors.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </Alert>
            )}
            {notice && <Alert tone="success">{notice}</Alert>}
            {restored && (
              <Alert tone="warning">
                <p>
                  O rascunho continua com alterações que não estão na v{restored.version}. Publicar
                  agora colocaria essas alterações no ar.
                </p>
                {restored.draft ? (
                  <button
                    type="button"
                    className={`${buttonClass('secondary', 'sm')} mt-2`}
                    disabled={busy || !isAdmin}
                    onClick={() => discardDraft(restored.draft!)}
                  >
                    Descartar rascunho e ficar igual à v{restored.version}
                  </button>
                ) : (
                  <p className="mt-1">
                    Não dá para montar o rascunho da v{restored.version} automaticamente (um bloco
                    mudou depois dela). Ajuste o rascunho à mão comparando em &quot;Ver
                    mudanças&quot;.
                  </p>
                )}
              </Alert>
            )}
          </div>
        )}

        <TemplateEditor
          draft={draft}
          live={live}
          onChange={edit}
          published={view.published}
          publishedIntentions={view.publishedIntentions}
          blocks={blocks}
          prefix={view.code.toLowerCase()}
          disabled={!isAdmin}
          answers={answers}
          onAnswers={setAnswers}
          agentName={agentName}
          onAgentName={setAgentName}
          progress={
            <Steps problems={problems} tested={tested === current} nextVersion={nextVersion} />
          }
          versions={{ count: view.versions.length, content: versionList }}
          identity={
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome" hint="O cliente vê ao escolher a função.">
                <input
                  className={inputClass}
                  value={name}
                  disabled={!isAdmin}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="Descrição" hint="Aparece abaixo do nome.">
                <input
                  className={inputClass}
                  value={description}
                  disabled={!isAdmin}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
            </div>
          }
        />
      </div>

      {publishing && (
        <Modal
          title={`Publicar a v${nextVersion}?`}
          onRequestClose={() => !busy && setPublishing(null)}
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={buttonClass('secondary')}
                disabled={busy}
                onClick={() => setPublishing(null)}
              >
                Voltar
              </button>
              <button
                type="button"
                className={buttonClass('primary')}
                disabled={busy}
                onClick={publish}
              >
                {busy ? 'Publicando…' : `Publicar v${nextVersion}`}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-zinc-700">
              A versão publicada não muda mais.{' '}
              {view.agents > 0
                ? `${view.agents} agente(s) usam esta função: recebem um aviso e só mudam quando o cliente republicar.`
                : 'Nenhum agente usa esta função ainda.'}
            </p>
            {tested !== current && (
              <Alert tone="error">
                Esta versão ainda não foi testada no sandbox. Recomendado antes de publicar.
              </Alert>
            )}
            <ChangeList title="Perguntas novas" items={publishing.fields.added} tone="green" />
            <ChangeList
              title="Perguntas removidas"
              items={publishing.fields.removed}
              tone="amber"
            />
            <ChangeList title="Ações novas" items={publishing.intentions.added} tone="green" />
            <ChangeList
              title="Ações removidas"
              items={publishing.intentions.removed}
              tone="amber"
            />
            <div>
              <p className="mb-2 text-xs font-medium text-zinc-500">
                {publishing.from
                  ? `Texto do agente: mudanças desde a v${publishing.from}`
                  : 'Texto do agente'}
              </p>
              {publishing.behavior.some((line) => line.op !== 'equal') ? (
                <BehaviorDiff lines={publishing.behavior} />
              ) : (
                <p className="text-sm text-zinc-500">Sem mudanças no texto.</p>
              )}
            </div>
          </div>
        </Modal>
      )}
      {confirmDelete && (
        <Modal
          title={`Excluir ${view.name}?`}
          onRequestClose={() => !busy && setConfirmDelete(false)}
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={buttonClass('secondary')}
                disabled={busy}
                onClick={() => setConfirmDelete(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={buttonClass('danger')}
                disabled={busy}
                onClick={remove}
              >
                {busy ? 'Excluindo…' : 'Excluir'}
              </button>
            </div>
          }
        >
          <p className="text-sm text-zinc-700">
            A função some do backoffice e do app. O código {view.code} fica reservado e não pode ser
            usado por outra função. As versões publicadas ficam guardadas.
          </p>
        </Modal>
      )}
      {diff && (
        <Modal
          title={`Mudanças da v${diff.from} para a v${diff.to}`}
          onRequestClose={() => setDiff(null)}
          footer={
            <div className="flex justify-end">
              <button
                type="button"
                className={buttonClass('secondary')}
                onClick={() => setDiff(null)}
              >
                Fechar
              </button>
            </div>
          }
        >
          <p className="mb-2 text-xs font-medium text-zinc-500">Comportamento</p>
          <BehaviorDiff lines={diff.behavior} />
          <p className="mt-4 mb-2 text-xs font-medium text-zinc-500">Conteúdo completo</p>
          <BehaviorDiff lines={diff.content.filter((line) => line.op !== 'equal')} />
        </Modal>
      )}
    </>
  );
}
