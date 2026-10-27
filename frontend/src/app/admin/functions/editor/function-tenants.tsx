'use client';

import type { AdminFunctionTemplateView, AdminTenantRow } from '@gptmaker/contracts';
import { useEffect, useState } from 'react';
import { CloseIcon, SearchIcon } from '@/components/icons';
import { Alert, buttonClass, Spinner } from '@/components/ui';
import { inputClass } from '../../../app/agents/agent-fields';
import { useAdmin } from '../../admin-provider';
import { message } from '../shared';
import { Section, Segmented } from './kit';

type TenantRef = AdminFunctionTemplateView['tenants'][number];
type Scope = 'all' | 'some';

const sameIds = (a: TenantRef[], b: TenantRef[]) =>
  a.length === b.length && a.every((t) => b.some((other) => other.id === t.id));

/**
 * Portais em que a função aparece na criação de agentes (design D14). Muda na hora, sem publicar
 * versão; fora da lista a função some da criação, mas os agentes que já a usam seguem normais.
 */
export function FunctionTenants({
  base,
  tenants: saved,
  disabled,
  onSaved,
}: {
  base: string;
  tenants: TenantRef[];
  disabled?: boolean;
  onSaved: (view: AdminFunctionTemplateView) => void;
}) {
  const { api } = useAdmin();
  const [scope, setScope] = useState<Scope>(saved.length ? 'some' : 'all');
  const [selected, setSelected] = useState<TenantRef[]>(saved);
  const [query, setQuery] = useState('');
  // Resultado junto do termo buscado: termo vazio ou antigo não mostra a lista.
  const [found, setFound] = useState<{ q: string; rows: AdminTenantRow[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const next = scope === 'all' ? [] : selected;
  const dirty = !sameIds(next, saved);
  const empty = scope === 'some' && selected.length === 0;

  // Busca de portais (mesma do menu Portais), com espera curta entre as teclas.
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api<AdminTenantRow[]>(`/admin/tenants?${new URLSearchParams({ q })}`)
        .then((rows) => !cancelled && setFound({ q, rows }))
        .catch(() => !cancelled && setFound({ q, rows: [] }));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, query]);

  function add(row: AdminTenantRow) {
    if (!selected.some((t) => t.id === row.id))
      setSelected([...selected, { id: row.id, domain: row.domain }]);
    setQuery('');
  }

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const view = await api<AdminFunctionTemplateView>(`${base}/tenants`, {
        method: 'PUT',
        body: JSON.stringify({ tenantIds: next.map((t) => t.id) }),
      });
      onSaved(view);
      setSelected(view.tenants);
      setScope(view.tenants.length ? 'some' : 'all');
      setNotice(
        view.tenants.length
          ? 'Salvo. Só os portais da lista veem a função na criação de agentes.'
          : 'Salvo. A função aparece na criação de agentes de todos os portais.',
      );
    } catch (e) {
      setError(message(e, 'Não foi possível salvar os portais.'));
    } finally {
      setBusy(false);
    }
  }

  const results = query.trim() && found?.q === query.trim() ? found.rows : null;
  const available = (results ?? []).filter((row) => !selected.some((t) => t.id === row.id));

  return (
    <Section
      title="Portais"
      description="Onde a função aparece na criação de agentes. Vale na hora, sem publicar versão; os agentes que já a usam não mudam."
      actions={
        !disabled && (
          <button
            type="button"
            className={buttonClass('secondary', 'sm')}
            disabled={busy || !dirty || empty}
            title={empty ? 'Escolha pelo menos um portal' : undefined}
            onClick={save}
          >
            {busy && <Spinner className="size-3.5" />}
            Salvar portais
          </button>
        )
      }
    >
      <div className="space-y-3">
        <Segmented<Scope>
          label="Portais da função"
          value={scope}
          disabled={disabled}
          onChange={setScope}
          options={[
            { value: 'all', label: 'Todos os portais' },
            { value: 'some', label: 'Só os portais escolhidos' },
          ]}
        />

        {scope === 'some' && (
          <>
            {selected.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {selected.map((t) => (
                  <li
                    key={t.id}
                    className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pr-1 pl-2.5 text-xs font-medium text-brand-700 ring-1 ring-brand-600/20 ring-inset"
                  >
                    {t.domain}
                    {!disabled && (
                      <button
                        type="button"
                        aria-label={`Tirar ${t.domain}`}
                        className="rounded-full p-0.5 hover:bg-brand-100"
                        onClick={() => setSelected(selected.filter((s) => s.id !== t.id))}
                      >
                        <CloseIcon className="size-3" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-amber-700">
                Nenhum portal escolhido: busque e adicione pelo menos um.
              </p>
            )}

            {!disabled && (
              <div className="relative max-w-md">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
                <input
                  className={`${inputClass} pl-9`}
                  placeholder="Buscar portal por domínio ou código"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {results && (
                  <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg">
                    {available.length === 0 ? (
                      <li className="px-3 py-2 text-zinc-500">Nenhum portal encontrado.</li>
                    ) : (
                      available.map((row) => (
                        <li key={row.id}>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-zinc-50"
                            onClick={() => add(row)}
                          >
                            <span className="truncate">{row.domain}</span>
                            <span className="font-mono text-xs text-zinc-400">
                              {row.tenantCode}
                            </span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
      </div>
    </Section>
  );
}
