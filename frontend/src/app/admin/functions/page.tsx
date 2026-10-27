'use client';

import {
  type AdminFunctionTemplateSummary,
  type AdminFunctionTemplateView,
  functionTemplateDraftSchema,
} from '@gptmaker/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  BotIcon,
  ChevronRightIcon,
  HistoryIcon,
  LayersIcon,
  PlusIcon,
  SearchIcon,
  UsersIcon,
} from '@/components/icons';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Card, EmptyState, Loading, PageHeader } from '@/components/ui';
import { Field, inputClass } from '../../app/agents/agent-fields';
import { useAdmin, useOperator } from '../admin-provider';
import { Segmented } from './editor/kit';
import { message } from './shared';

/** Rascunho inicial de uma função nova: blocos padrão e o mínimo para começar. */
const STARTER = {
  agentType: 'SUPPORT',
  settings: { enabledHumanTransfer: true, limitSubjects: true },
  profile: { jobName: '{{empresa.nome}}', jobDescription: '{{empresa.descricao}}', jobSite: '' },
  blocks: ['comum', 'registro', 'duvida', 'transferir'],
  fields: [
    {
      kind: 'TEXT',
      id: 'funcao.missao',
      label: 'Exemplo de campo',
      required: true,
      maxLength: 200,
      multiline: true,
    },
  ],
  behavior:
    'Você é {{agente.nome}}, da {{empresa.nome}}. {{empresa.descricao}}\n\n{{funcao.missao}}\n\n{{bloco.duvida}}\n\nESTILO\n{{comum.tom}} {{comum.emojis}}\n\n{{avancado.instrucoes_adicionais}}',
  intentions: [],
};

function NewFunction({
  onClose,
  functions,
}: {
  onClose: () => void;
  functions: AdminFunctionTemplateSummary[];
}) {
  const { api } = useAdmin();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  // Função de origem (cópia do rascunho) ou vazio: começa do modelo mínimo.
  const [copyFrom, setCopyFrom] = useState(functions[0]?.code ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const view = await api<AdminFunctionTemplateView>('/admin/functions', {
        method: 'POST',
        body: JSON.stringify(
          copyFrom
            ? { code, name, description, copyFrom }
            : { code, name, description, draft: functionTemplateDraftSchema.parse(STARTER) },
        ),
      });
      router.push(`/admin/functions/${view.code}`);
    } catch (e) {
      setError(message(e, 'Não foi possível criar a função.'));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Nova função"
      description="Comece de um template parecido (veja a skill gptthink-function-templates)."
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
            disabled={busy || !code || !name || !description}
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
          <Field label="Código" hint="Maiúsculas e _, ex.: POS_VENDA. Não muda depois.">
            <input
              className={`${inputClass} font-mono`}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Nome">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Field label="Descrição" hint="Aparece para o cliente ao escolher a função.">
          <textarea
            className={inputClass}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field
          label="Começar a partir de"
          hint="O rascunho da função escolhida é copiado; as duas ficam independentes."
        >
          <select
            className={inputClass}
            value={copyFrom}
            onChange={(e) => setCopyFrom(e.target.value)}
          >
            {functions.map((fn) => (
              <option key={fn.code} value={fn.code}>
                {fn.name}
              </option>
            ))}
            <option value="">Em branco (modelo mínimo)</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}

type Filter = 'all' | 'active' | 'inactive';

/** "há 3 dias", "há 2 h": quando o rascunho foi alterado. */
function relative(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return days === 1 ? 'há 1 dia' : `há ${days} dias`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

function FunctionCard({ fn }: { fn: AdminFunctionTemplateSummary }) {
  return (
    <Link
      href={`/admin/functions/${fn.code}`}
      className={`group flex flex-col rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-xs transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md ${
        fn.active ? '' : 'opacity-70'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
          <BotIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-zinc-900 group-hover:text-brand-700">
            {fn.name}
          </p>
          <p className="font-mono text-xs text-zinc-400">{fn.code}</p>
        </div>
        {!fn.active ? (
          <Badge tone="zinc">inativa</Badge>
        ) : fn.latestVersion ? (
          <Badge tone="green">v{fn.latestVersion}</Badge>
        ) : (
          <Badge tone="amber">rascunho</Badge>
        )}
      </div>
      <p className="mt-3 line-clamp-2 min-h-10 text-sm text-zinc-500">{fn.description}</p>
      <div className="mt-4 flex items-center gap-4 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <UsersIcon className="size-3.5" />
          {fn.agents === 1 ? '1 agente' : `${fn.agents} agentes`}
        </span>
        <span className="flex items-center gap-1.5">
          <HistoryIcon className="size-3.5" />
          alterada {relative(fn.updatedAt)}
        </span>
        <ChevronRightIcon className="ml-auto size-4 text-zinc-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-500" />
      </div>
    </Link>
  );
}

/** Templates de função (spec admin-backoffice, "Gestão de templates de função"). */
export default function FunctionsPage() {
  const { api } = useAdmin();
  const operator = useOperator();
  const [rows, setRows] = useState<AdminFunctionTemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let cancelled = false;
    api<AdminFunctionTemplateSummary[]>('/admin/functions')
      .then((list) => !cancelled && setRows(list))
      .catch(
        (e: unknown) => !cancelled && setError(message(e, 'Não foi possível carregar as funções.')),
      );
    return () => {
      cancelled = true;
    };
  }, [api]);

  const isAdmin = operator.role === 'ADMIN';
  const term = query.trim().toLowerCase();
  const shown = (rows ?? []).filter(
    (fn) =>
      (filter === 'all' || fn.active === (filter === 'active')) &&
      (!term ||
        fn.name.toLowerCase().includes(term) ||
        fn.code.toLowerCase().includes(term) ||
        fn.description.toLowerCase().includes(term)),
  );

  return (
    <>
      <PageHeader
        title="Funções do agente"
        description="Templates que montam o comportamento, os treinamentos e as ações dos agentes. Agentes só mudam quando o cliente republica."
        actions={
          <div className="flex gap-2">
            <Link href="/admin/functions/blocks" className={buttonClass('secondary')}>
              <LayersIcon className="size-4" /> Blocos compartilhados
            </Link>
            {isAdmin && (
              <button
                type="button"
                className={buttonClass('primary')}
                onClick={() => setCreating(true)}
              >
                <PlusIcon className="size-4" /> Nova função
              </button>
            )}
          </div>
        }
      />
      {error && <Alert tone="error">{error}</Alert>}
      {!rows ? (
        !error && <Loading />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: 'Funções ativas', value: rows.filter((fn) => fn.active).length },
              { label: 'Publicadas', value: rows.filter((fn) => fn.latestVersion).length },
              { label: 'Agentes usando', value: rows.reduce((sum, fn) => sum + fn.agents, 0) },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-2xl border border-zinc-200/80 bg-white px-5 py-4 shadow-xs"
              >
                <p className="text-xs font-medium text-zinc-500">{stat.label}</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
              <input
                className={`${inputClass} mt-0 pl-9`}
                placeholder="Buscar por nome, código ou descrição"
                aria-label="Buscar funções"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Segmented
              label="Filtrar funções"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `Todas (${rows.length})` },
                { value: 'active', label: 'Ativas' },
                { value: 'inactive', label: 'Inativas' },
              ]}
            />
          </div>

          {shown.length === 0 ? (
            <Card>
              <EmptyState
                icon={<SearchIcon className="size-5" />}
                title="Nenhuma função encontrada"
                description={term ? 'Tente outro termo de busca.' : 'Nada neste filtro.'}
              />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((fn) => (
                <FunctionCard key={fn.code} fn={fn} />
              ))}
              {isAdmin && filter !== 'inactive' && !term && (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-200 text-sm font-medium text-zinc-500 transition-colors hover:border-brand-400 hover:bg-brand-50/40 hover:text-brand-700"
                >
                  <span className="flex size-10 items-center justify-center rounded-full bg-zinc-100">
                    <PlusIcon className="size-5" />
                  </span>
                  Nova função
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {creating && rows && <NewFunction functions={rows} onClose={() => setCreating(false)} />}
    </>
  );
}
