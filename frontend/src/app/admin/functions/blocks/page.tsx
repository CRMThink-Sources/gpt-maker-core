'use client';

import {
  type AdminFunctionBlockView,
  type FunctionBlockContent,
  functionBlockContentSchema,
} from '@gptmaker/contracts';
import { useCallback, useEffect, useState } from 'react';
import { LayersIcon, PlusIcon, RocketIcon, SaveIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Card, EmptyState, Loading, PageHeader } from '@/components/ui';
import { Field, inputClass } from '../../../app/agents/agent-fields';
import { useAdmin, useOperator } from '../../admin-provider';
import { BlockEditor } from '../editor/template-editor';
import { Menu } from '../editor/kit';
import { allIds, renameId, slug, uniqueId } from '../editor/model';
import { message } from '../shared';

const EMPTY_BLOCK: FunctionBlockContent = {
  fields: [],
  behavior: '',
  intentions: [],
  crmAccess: false,
};

/**
 * Cópia do rascunho de outro bloco com os ids dos campos no prefixo do bloco novo (`comum.tom` e
 * `empresa.nome` ⇒ `novo.tom` e `novo.nome`): ids repetidos impediriam usar os dois blocos na mesma
 * função.
 */
function copyBlock(source: AdminFunctionBlockView, code: string): FunctionBlockContent {
  const ids = new Map<string, string>();
  const taken = new Set<string>();
  for (const id of allIds(source.draft.fields)) {
    const next = uniqueId(`${code}.${id.slice(id.indexOf('.') + 1)}`, taken);
    taken.add(next);
    ids.set(id, next);
  }
  // Referências (marcadores, condições) e depois o próprio id de cada campo.
  let draft = source.draft;
  for (const [from, to] of ids) draft = renameId(draft, from, to);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [
        key,
        key === 'id' && typeof value === 'string' ? (ids.get(value) ?? value) : walk(value),
      ]),
    );
  };
  return walk(draft) as FunctionBlockContent;
}

function NewBlock({
  blocks,
  onClose,
  onCreated,
}: {
  blocks: AdminFunctionBlockView[];
  onClose: () => void;
  onCreated: (block: AdminFunctionBlockView) => void;
}) {
  const { api } = useAdmin();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  // O código acompanha o nome até ser editado à mão.
  const [autoCode, setAutoCode] = useState(true);
  const [copyFrom, setCopyFrom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const source = blocks.find((block) => block.code === copyFrom);
  const validCode = /^[a-z][a-z0-9_]*$/.test(code);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await api<AdminFunctionBlockView>('/admin/function-blocks', {
          method: 'POST',
          body: JSON.stringify({
            code,
            name: name.trim(),
            draft: source ? copyBlock(source, code) : EMPTY_BLOCK,
          }),
        }),
      );
    } catch (e) {
      setError(message(e, 'Não foi possível criar o bloco.'));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Novo bloco compartilhado"
      onRequestClose={() => !busy && onClose()}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className={buttonClass('secondary')}
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className={buttonClass('primary')}
            onClick={create}
            disabled={busy || !name.trim() || !validCode}
          >
            {busy ? 'Criando…' : 'Criar'}
          </button>
        </div>
      }
    >
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome">
            <input
              className={inputClass}
              value={name}
              autoFocus
              onChange={(e) => {
                setName(e.target.value);
                if (autoCode) setCode(e.target.value.trim() ? slug(e.target.value) : '');
              }}
            />
          </Field>
          <Field
            label="Código"
            hint={`Minúsculas e _. Entra no texto como {{bloco.${code || 'codigo'}}}. Não muda depois.`}
          >
            <input
              className={`${inputClass} font-mono`}
              value={code}
              onChange={(e) => {
                setAutoCode(false);
                setCode(e.target.value.toLowerCase());
              }}
            />
          </Field>
        </div>
        <Field
          label="Começar a partir de"
          hint={
            source
              ? `Copia o rascunho de ${source.name}. Os ids dos campos passam a usar o código do bloco novo (ex.: ${code || 'codigo'}.tom). Os dois ficam independentes.`
              : 'Bloco vazio: sem perguntas, texto ou ações.'
          }
        >
          <select
            className={inputClass}
            value={copyFrom}
            onChange={(e) => setCopyFrom(e.target.value)}
          >
            <option value="">Em branco</option>
            {blocks.map((block) => (
              <option key={block.code} value={block.code}>
                {block.name}
              </option>
            ))}
          </select>
        </Field>
        {source && source.draft.intentions.length > 0 && (
          <p className="text-xs text-amber-700">
            As ações copiadas mantêm o identificador. Renomeie-as no bloco novo antes de usar os
            dois blocos na mesma função.
          </p>
        )}
      </div>
    </Modal>
  );
}

/**
 * Blocos compartilhados (design D3): editar e publicar um bloco não muda nenhum template; ele entra
 * na próxima versão publicada dos templates que o incluem.
 */
export default function FunctionBlocksPage() {
  const { api } = useAdmin();
  const isAdmin = useOperator().role === 'ADMIN';
  const [blocks, setBlocks] = useState<AdminFunctionBlockView[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<FunctionBlockContent | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const select = useCallback((block: AdminFunctionBlockView) => {
    setSelected(block.code);
    setDraft(block.draft);
    setNotice(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<AdminFunctionBlockView[]>('/admin/function-blocks')
      .then((list) => {
        if (cancelled) return;
        setBlocks(list);
        if (list[0]) select(list[0]);
      })
      .catch(
        (e: unknown) => !cancelled && setError(message(e, 'Não foi possível carregar os blocos.')),
      );
    return () => {
      cancelled = true;
    };
  }, [api, select]);

  const current = blocks?.find((block) => block.code === selected) ?? null;

  async function act(path: 'draft' | 'publish') {
    if (!current) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      let body: string | undefined;
      if (path === 'draft') {
        const parsed = functionBlockContentSchema.safeParse(draft);
        if (!parsed.success) throw new Error('O bloco tem campos incompletos; veja a seção JSON.');
        body = JSON.stringify({ draft: parsed.data });
      }
      const updated = await api<AdminFunctionBlockView>(
        `/admin/function-blocks/${current.code}/${path}`,
        { method: path === 'draft' ? 'PUT' : 'POST', body },
      );
      setBlocks(
        (list) => list?.map((block) => (block.code === updated.code ? updated : block)) ?? null,
      );
      setNotice(
        path === 'draft'
          ? 'Rascunho do bloco salvo.'
          : 'Bloco publicado. Publique os templates que o usam para ele chegar aos agentes.',
      );
    } catch (e) {
      setError(
        e instanceof Error && !('code' in e) ? e.message : message(e, 'Não foi possível salvar.'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!current) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/admin/function-blocks/${current.code}`, { method: 'DELETE' });
      const rest = (blocks ?? []).filter((block) => block.code !== current.code);
      setBlocks(rest);
      setConfirmDelete(false);
      if (rest[0]) select(rest[0]);
      else {
        setSelected(null);
        setDraft(null);
      }
      setNotice(`Bloco ${current.name} excluído.`);
    } catch (e) {
      setConfirmDelete(false);
      setError(message(e, 'Não foi possível excluir o bloco.'));
    } finally {
      setBusy(false);
    }
  }

  function created(block: AdminFunctionBlockView) {
    setBlocks((list) => [...(list ?? []), block].sort((a, b) => a.code.localeCompare(b.code)));
    setCreating(false);
    select(block);
    setNotice(
      'Bloco criado. Edite, salve e publique; depois inclua-o nas funções pela seção Geral.',
    );
  }

  return (
    <>
      <PageHeader
        back={{ href: '/admin/functions', label: 'Funções' }}
        title="Blocos compartilhados"
        description="Campos, texto e ações reaproveitados por várias funções."
        actions={
          isAdmin &&
          blocks && (
            <button
              type="button"
              className={buttonClass('primary')}
              onClick={() => setCreating(true)}
            >
              <PlusIcon className="size-4" /> Novo bloco
            </button>
          )
        }
      />
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      )}
      {!blocks ? (
        !error && <Loading />
      ) : blocks.length === 0 ? (
        <Card>
          <EmptyState
            icon={<LayersIcon className="size-5" />}
            title="Nenhum bloco"
            description="Blocos guardam perguntas, texto e ações que várias funções usam."
          />
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-[17rem_minmax(0,1fr)]">
          <nav className="space-y-1.5 md:sticky md:top-6 md:self-start">
            {blocks.map((block) => {
              const active = block.code === selected;
              return (
                <button
                  key={block.code}
                  type="button"
                  onClick={() => select(block)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                    active
                      ? 'border-brand-200 bg-white shadow-sm ring-1 ring-brand-100'
                      : 'border-transparent hover:border-zinc-200 hover:bg-white'
                  }`}
                >
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
                      active ? 'bg-brand-600 text-white' : 'bg-zinc-100 text-zinc-500'
                    }`}
                  >
                    <LayersIcon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-zinc-900">
                        {block.name}
                      </span>
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${block.publishedAt ? 'bg-emerald-500' : 'bg-amber-500'}`}
                        title={block.publishedAt ? 'Publicado' : 'Nunca publicado'}
                      />
                    </span>
                    <span className="block font-mono text-xs text-zinc-400">{block.code}</span>
                    <span className="mt-0.5 block text-xs text-zinc-500">
                      {block.usedBy.length === 0
                        ? 'Nenhuma função usa'
                        : block.usedBy.length === 1
                          ? 'Usado por 1 função'
                          : `Usado por ${block.usedBy.length} funções`}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>
          {current && (
            <div className="min-w-0 rounded-2xl border border-zinc-200/80 bg-white shadow-xs">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
                      {current.name}
                    </h2>
                    {current.publishedAt ? (
                      <Badge tone="green">
                        publicado em {new Date(current.publishedAt).toLocaleDateString('pt-BR')}
                      </Badge>
                    ) : (
                      <Badge tone="amber">nunca publicado</Badge>
                    )}
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                    <span className="font-mono">{`{{bloco.${current.code}}}`}</span>
                    <span aria-hidden>·</span>
                    {current.usedBy.length ? (
                      <>
                        Usado por
                        {current.usedBy.map((name) => (
                          <span
                            key={name}
                            className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-zinc-600"
                          >
                            {name}
                          </span>
                        ))}
                      </>
                    ) : (
                      'Nenhuma função usa'
                    )}
                  </p>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={buttonClass('secondary')}
                      disabled={busy}
                      onClick={() => act('draft')}
                    >
                      <SaveIcon className="size-4" /> Salvar
                    </button>
                    <button
                      type="button"
                      className={buttonClass('primary')}
                      disabled={busy}
                      onClick={() => act('publish')}
                    >
                      <RocketIcon className="size-4" /> Publicar bloco
                    </button>
                    <Menu
                      items={[
                        {
                          label: 'Excluir bloco',
                          danger: true,
                          disabled: busy || current.usedBy.length > 0,
                          title:
                            current.usedBy.length > 0
                              ? `Usado por ${current.usedBy.join(', ')}: tire o bloco dessas funções (seção Geral) antes de excluir`
                              : undefined,
                          onClick: () => setConfirmDelete(true),
                        },
                      ]}
                    />
                  </div>
                )}
              </div>
              <div className="p-5">
                {draft && (
                  <BlockEditor
                    key={current.code}
                    value={draft}
                    onChange={setDraft}
                    prefix={current.code}
                    disabled={!isAdmin}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {creating && blocks && (
        <NewBlock blocks={blocks} onClose={() => setCreating(false)} onCreated={created} />
      )}
      {confirmDelete && current && (
        <Modal
          title={`Excluir ${current.name}?`}
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
            O bloco some do backoffice e não pode mais ser incluído em funções. O código{' '}
            {current.code} fica reservado. As versões já publicadas das funções não mudam: guardam o
            conteúdo do bloco.
          </p>
        </Modal>
      )}
    </>
  );
}
