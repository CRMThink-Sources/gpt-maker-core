'use client';

import type { DiffLine, FunctionPreview } from '@gptmaker/contracts';
import { Alert, Badge, Card } from '@/components/ui';

const SETTING_LABELS: Record<string, string> = {
  enabledHumanTransfer: 'Transferência para atendente',
  enabledEmoji: 'Emojis',
  limitSubjects: 'Falar só dos assuntos do negócio',
  onLackKnowLedge: 'Mensagem quando não souber',
  knowledgeByFunction: 'Busca inteligente na base',
};

const AGENT_LABELS: Record<string, string> = {
  agentType: 'Tipo',
  communicationType: 'Tom',
  jobName: 'Nome da empresa',
  jobDescription: 'Sobre a empresa',
  jobSite: 'Site',
};

function show(value: unknown): string {
  if (value === true) return 'sim';
  if (value === false) return 'não';
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

/** Comportamento com o que entra em verde e o que sai em vermelho. */
export function BehaviorDiff({ lines }: { lines: DiffLine[] }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs leading-relaxed whitespace-pre-wrap">
      {lines.map((line, index) => (
        <div
          key={index}
          className={
            line.op === 'add'
              ? 'bg-green-50 text-green-800'
              : line.op === 'remove'
                ? 'bg-red-50 text-red-700 line-through'
                : 'text-zinc-700'
          }
        >
          {line.op === 'add' ? '+ ' : line.op === 'remove' ? '− ' : '  '}
          {line.text || ' '}
        </div>
      ))}
    </pre>
  );
}

/**
 * O que a publicação muda no agente (spec "Prévia e publicação"). `modeChange` é o nome do modo
 * novo quando a publicação troca o modo: sem ela, um plano vazio diria que nada muda.
 */
export function FunctionPreviewView({
  preview,
  modeChange = null,
}: {
  preview: FunctionPreview;
  modeChange?: string | null;
}) {
  const { plan, compiled } = preview;
  const trainings = plan.trainings;
  const intentions = plan.intentions;
  // A removida não está no compilado: o nome vem do agente (`removedIntentions`).
  const intentionName = (key: string) => preview.removedIntentions[key] ?? key;

  return (
    <div className="space-y-5">
      {preview.issues.length > 0 && (
        <Alert tone="error">
          Revise o formulário:{' '}
          {preview.issues.length === 1 ? 'há 1 campo' : `há ${preview.issues.length} campos`} com
          problema.
        </Alert>
      )}
      {compiled.errors.map((error) => (
        <Alert key={error} tone="error">
          {error}
        </Alert>
      ))}
      {plan.empty && preview.mediaToRemove.length === 0 && (
        <Alert tone="success">
          {modeChange
            ? `O agente passa para o modo ${modeChange}; o texto, a base e as ações continuam iguais.`
            : 'Nada muda no agente com estas respostas.'}
        </Alert>
      )}

      <Card className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-zinc-900">Texto do agente</h4>
          <span className="text-xs text-zinc-500">
            {compiled.behavior.length} de 3000 caracteres
          </span>
        </div>
        {plan.behavior.changed ? (
          <BehaviorDiff lines={plan.behavior.diff} />
        ) : (
          <p className="text-sm text-zinc-500">Sem mudanças.</p>
        )}
      </Card>

      {(plan.agent.length > 0 || plan.settings.length > 0) && (
        <Card className="space-y-2 p-5">
          <h4 className="text-sm font-semibold text-zinc-900">Configurações</h4>
          <ul className="space-y-1 text-sm text-zinc-700">
            {plan.agent.map((change) => (
              <li key={change.field}>
                {AGENT_LABELS[change.field] ?? change.field}: {show(change.from)} →{' '}
                {show(change.to)}
              </li>
            ))}
            {plan.settings.map((change) => (
              <li key={change.key}>
                {SETTING_LABELS[change.key] ?? change.key}: {show(change.from)} → {show(change.to)}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="space-y-2 p-5">
        <h4 className="text-sm font-semibold text-zinc-900">Base de conhecimento</h4>
        {trainings.create.length + trainings.update.length + trainings.remove.length === 0 ? (
          <p className="text-sm text-zinc-500">Sem mudanças.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {trainings.create.map((item) => (
              <li key={item.key} className="flex gap-2">
                <Badge tone="green">novo</Badge>
                <span className="line-clamp-2 text-zinc-700">{item.text}</span>
              </li>
            ))}
            {trainings.update.map((item) => (
              <li key={item.key} className="flex gap-2">
                <Badge tone="brand">alterado</Badge>
                <span className="line-clamp-2 text-zinc-700">{item.text}</span>
              </li>
            ))}
            {trainings.remove.length > 0 && (
              <li className="flex gap-2">
                <Badge tone="amber">removido</Badge>
                <span className="text-zinc-700">
                  {trainings.remove.length === 1 ? '1 item' : `${trainings.remove.length} itens`}
                </span>
              </li>
            )}
          </ul>
        )}
        {preview.mediaToRemove.length > 0 && (
          <p className="text-sm text-amber-700">
            Saem também {preview.mediaToRemove.length} treinamento(s) de site ou vídeo do modo
            avançado.
          </p>
        )}
      </Card>

      <Card className="space-y-2 p-5">
        <h4 className="text-sm font-semibold text-zinc-900">Ações do agente</h4>
        <ul className="space-y-1 text-sm text-zinc-700">
          {compiled.intentions.map((intention) => {
            const created = intentions.create.some((item) => item.key === intention.key);
            const updated = intentions.update.some((item) => item.key === intention.key);
            return (
              <li key={intention.key} className="flex items-center gap-2">
                {intention.input.name}
                {created && <Badge tone="green">nova</Badge>}
                {updated && <Badge tone="brand">alterada</Badge>}
              </li>
            );
          })}
          {intentions.remove.map((key) => (
            <li key={key} className="flex items-center gap-2 text-zinc-500">
              {intentionName(key)} <Badge tone="amber">removida</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
