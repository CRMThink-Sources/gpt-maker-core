'use client';

import Link from 'next/link';
import { useAppSession } from './session-provider';

export default function ClientAppHome() {
  const { session } = useAppSession();
  return (
    <section>
      <h1 className="text-2xl font-semibold">Agentes de IA</h1>
      <p className="mt-2 text-sm text-zinc-600">Seus agentes aparecerão aqui.</p>
      {!session.canManage && (
        <p className="mt-4 text-sm text-zinc-600">
          Você pode consultar os agentes. Para alterá-los, peça acesso a um administrador do portal.
        </p>
      )}
      {session.user.isAdmin && (
        <Link
          href="/app/permissions"
          className="mt-6 inline-block text-sm text-violet-700 underline"
        >
          Quem pode gerenciar os agentes
        </Link>
      )}
    </section>
  );
}
