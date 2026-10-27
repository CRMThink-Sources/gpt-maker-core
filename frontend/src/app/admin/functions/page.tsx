'use client';

import {
  type AdminFunctionTemplateSummary,
  type AdminFunctionTemplateView,
  functionTemplateDraftSchema,
} from '@gptmaker/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PlusIcon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { Alert, Badge, buttonClass, Card, Loading, PageHeader } from '@/components/ui';
import { Field, inputClass } from '../../app/agents/agent-fields';
import { useAdmin, useOperator } from '../admin-provider';
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

/** Templates de função (spec admin-backoffice, "Gestão de templates de função"). */
export default function FunctionsPage() {
  const { api } = useAdmin();
  const operator = useOperator();
  const [rows, setRows] = useState<AdminFunctionTemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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

  return (
    <>
      <PageHeader
        title="Funções do agente"
        description="Templates que montam o comportamento, os treinamentos e as ações dos agentes. Agentes só mudam quando o cliente republica."
        actions={
          <div className="flex gap-2">
            <Link href="/admin/functions/blocks" className={buttonClass('secondary')}>
              Blocos compartilhados
            </Link>
            {operator.role === 'ADMIN' && (
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
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-100 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-5 py-3 font-medium">Função</th>
                <th className="px-5 py-3 font-medium">Versão publicada</th>
                <th className="px-5 py-3 font-medium">Agentes</th>
                <th className="px-5 py-3 font-medium">Rascunho alterado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row) => (
                <tr key={row.code} className="hover:bg-zinc-50">
                  <td className="px-5 py-3">
                    <Link
                      href={`/admin/functions/${row.code}`}
                      className="font-medium text-brand-700"
                    >
                      {row.name}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-zinc-500">{row.code}</span>
                    {!row.active && (
                      <span className="ml-2">
                        <Badge tone="zinc">inativa</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {row.latestVersion ? (
                      `v${row.latestVersion}`
                    ) : (
                      <Badge tone="amber">nunca publicada</Badge>
                    )}
                  </td>
                  <td className="px-5 py-3">{row.agents}</td>
                  <td className="px-5 py-3 text-zinc-500">
                    {new Date(row.updatedAt).toLocaleString('pt-BR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {creating && rows && <NewFunction functions={rows} onClose={() => setCreating(false)} />}
    </>
  );
}
