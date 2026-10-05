'use client';

import type { AdminTenantRow } from '@gptmaker/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Card, Loading, PageHeader, Spinner } from '@/components/ui';
import { ApiRequestError } from '@/lib/platform-session';
import { inputClass } from '../../app/agents/agent-fields';
import { useAdmin } from '../admin-provider';
import { credits, dateTime, SubscriptionBadge, TenantStatusBadge } from './shared';

/** Portais (tenants), dos mais usados recentemente aos parados (15.4). */
export default function AdminTenantsPage() {
  const { api } = useAdmin();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [result, setResult] = useState<{
    q: string;
    rows?: AdminTenantRow[];
    error?: string;
  } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    const params = debounced ? `?${new URLSearchParams({ q: debounced })}` : '';
    api<AdminTenantRow[]>(`/admin/tenants${params}`)
      .then((rows) => !cancelled && setResult({ q: debounced, rows }))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setResult({
            q: debounced,
            error: e instanceof ApiRequestError ? e.message : 'Não foi possível carregar.',
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [api, debounced]);

  const loading = result?.q !== debounced;
  const rows = result?.rows ?? null;

  return (
    <>
      <PageHeader
        title="Portais"
        description="Portais Bitrix24 com o app instalado: assinatura, saldo e uso. Até 100 por busca."
      />
      <div className="mb-4 flex items-center gap-3">
        <input
          type="search"
          placeholder="Buscar por domínio ou código"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${inputClass} mt-0 max-w-sm`}
        />
        {loading && result && <Spinner className="size-4" />}
      </div>
      {result?.error && <Alert tone="error">{result.error}</Alert>}
      {!result && <Loading />}
      {rows && rows.length === 0 && (
        <p className="text-sm text-zinc-500">Nenhum portal encontrado.</p>
      )}
      {rows && rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-3xl text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="px-4 py-2.5 font-medium">Portal</th>
                <th className="px-4 py-2.5 font-medium">Situação</th>
                <th className="px-4 py-2.5 font-medium">Assinatura</th>
                <th className="px-4 py-2.5 text-right font-medium">Saldo</th>
                <th className="px-4 py-2.5 text-right font-medium">Agentes</th>
                <th className="px-4 py-2.5 font-medium">Última mensagem</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/tenants/${row.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {row.domain}
                    </Link>
                    <p className="text-xs text-zinc-400">
                      {row.tenantCode} · instalação {row.installationId}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <TenantStatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3">
                    <SubscriptionBadge subscription={row.subscription} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-900">
                    {credits(row.balance.total)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                    {row.agents.active}/{row.agents.total}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{dateTime(row.lastMessageAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
