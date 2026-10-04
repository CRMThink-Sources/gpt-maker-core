'use client';

import { Card, PageHeader } from '@/components/ui';
import { useOperator } from './admin-provider';

const SECTIONS = [
  ['Assinaturas', 'Projeção local, eventos da plataforma e link para o SPA (15.5).'],
  ['Workspace GPTMaker', 'Saúde, créditos, agentes órfãos e fora de sincronia (15.6).'],
  [
    'Reconciliação',
    'Consumo real × débitos, ajustes para revisão e relatório do partner (14.x, 15.7).',
  ],
] as const;

/** Início do backoffice: o que já existe e o que vem nas próximas tarefas. */
export default function AdminHome() {
  const operator = useOperator();
  return (
    <>
      <PageHeader
        title={`Olá, ${operator.name.split(' ')[0]}`}
        description="Operação do ThinkFlow AI: planos, tenants, modelos, workspace e reconciliação."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map(([title, description]) => (
          <Card key={title} className="p-4">
            <p className="text-sm font-semibold text-zinc-900">{title}</p>
            <p className="mt-1 text-sm text-zinc-500">{description}</p>
            <p className="mt-3 text-xs font-medium text-zinc-400">Em breve</p>
          </Card>
        ))}
      </div>
    </>
  );
}
