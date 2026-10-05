'use client';

import type { AdminTenantFailures } from '@gptmaker/contracts';
import { useEffect, useState } from 'react';
import { Alert, Card, Loading } from '@/components/ui';
import { ApiRequestError } from '@/lib/platform-session';
import { useAdmin } from '../../admin-provider';
import { FAILURE_SOURCES } from '../../failure-sources';
import { dateTime } from '../shared';

/** Falhas definitivas do portal nos últimos 30 dias (15.7). */
export function TenantFailures({ tenantId }: { tenantId: string }) {
  const { api } = useAdmin();
  const [data, setData] = useState<AdminTenantFailures | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<AdminTenantFailures>(`/admin/tenants/${tenantId}/failures`)
      .then((d) => !cancelled && setData(d))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setError(
            e instanceof ApiRequestError && !e.code.startsWith('HTTP_')
              ? e.message
              : 'Não foi possível carregar.',
          ),
      );
    return () => {
      cancelled = true;
    };
  }, [api, tenantId]);

  const items = data ? (all ? data.items : data.items.slice(0, 10)) : [];

  return (
    <Card className="mt-4">
      <div className="border-b border-zinc-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-zinc-900">
          Erros recentes{data ? ` (${data.items.length})` : ''}
        </h2>
        <p className="text-xs text-zinc-500">
          Últimos 30 dias, só o que esgotou as tentativas. Mensagem com falha: o diálogo foi para um
          operador, sem débito.
        </p>
      </div>
      {error && (
        <Alert tone="error" className="m-4">
          {error}
        </Alert>
      )}
      {!data && !error && <Loading />}
      {data &&
        (data.items.length === 0 ? (
          <p className="px-5 py-4 text-sm text-zinc-500">Nenhum erro nos últimos 30 dias.</p>
        ) : (
          <>
            <ul className="divide-y divide-zinc-100">
              {items.map((item, index) => (
                <li key={index} className="px-5 py-2.5 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="w-28 shrink-0 text-xs tabular-nums text-zinc-500">
                      {dateTime(item.at)}
                    </span>
                    <span className="text-xs font-medium text-zinc-500">
                      {FAILURE_SOURCES[item.source]}
                    </span>
                    <span className="text-zinc-900">{item.subject}</span>
                    {item.attempts !== null && (
                      <span className="ml-auto text-xs text-zinc-500">
                        {item.attempts} tentativa(s)
                      </span>
                    )}
                  </div>
                  {item.error && (
                    <p className="mt-0.5 break-all text-xs text-amber-800">{item.error}</p>
                  )}
                </li>
              ))}
            </ul>
            {data.items.length > 10 && (
              <button
                type="button"
                onClick={() => setAll(!all)}
                className="px-5 py-2 text-xs text-brand-700 hover:underline"
              >
                {all ? 'Mostrar menos' : `Mostrar todos (${data.items.length})`}
              </button>
            )}
          </>
        ))}
    </Card>
  );
}
