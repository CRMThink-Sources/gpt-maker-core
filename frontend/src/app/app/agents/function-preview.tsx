'use client';

import type { DiffLine, FunctionPreview } from '@gptmaker/contracts';
import { Alert, Badge, Card } from '@/components/ui';
import { type T, useT } from '@/i18n';

function show(value: unknown, t: T): string {
  if (value === true) return t('preview.yes');
  if (value === false) return t('preview.no');
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
  const t = useT('assist');
  const label = (group: 'agentLabels' | 'settingLabels', key: string) =>
    t.has(`preview.${group}.${key}`) ? t(`preview.${group}.${key}`) : key;
  const { plan, compiled } = preview;
  const trainings = plan.trainings;
  const intentions = plan.intentions;
  // A removida não está no compilado: o nome vem do agente (`removedIntentions`).
  const intentionName = (key: string) => preview.removedIntentions[key] ?? key;

  return (
    <div className="space-y-5">
      {preview.issues.length > 0 && (
        <Alert tone="error">{t('preview.issues', { count: preview.issues.length })}</Alert>
      )}
      {compiled.errors.map((error) => (
        <Alert key={error} tone="error">
          {error}
        </Alert>
      ))}
      {plan.empty && preview.mediaToRemove.length === 0 && (
        <Alert tone="success">
          {modeChange ? t('preview.modeChange', { mode: modeChange }) : t('preview.nothingChanges')}
        </Alert>
      )}

      <Card className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-zinc-900">{t('preview.agentText')}</h4>
          <span className="text-xs text-zinc-500">
            {t('preview.charCount', { count: compiled.behavior.length })}
          </span>
        </div>
        {plan.behavior.changed ? (
          <BehaviorDiff lines={plan.behavior.diff} />
        ) : (
          <p className="text-sm text-zinc-500">{t('preview.noChanges')}</p>
        )}
      </Card>

      {(plan.agent.length > 0 || plan.settings.length > 0) && (
        <Card className="space-y-2 p-5">
          <h4 className="text-sm font-semibold text-zinc-900">{t('preview.settings')}</h4>
          <ul className="space-y-1 text-sm text-zinc-700">
            {plan.agent.map((change) => (
              <li key={change.field}>
                {label('agentLabels', change.field)}: {show(change.from, t)} → {show(change.to, t)}
              </li>
            ))}
            {plan.settings.map((change) => (
              <li key={change.key}>
                {label('settingLabels', change.key)}: {show(change.from, t)} → {show(change.to, t)}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="space-y-2 p-5">
        <h4 className="text-sm font-semibold text-zinc-900">{t('preview.knowledge')}</h4>
        {trainings.create.length + trainings.update.length + trainings.remove.length === 0 ? (
          <p className="text-sm text-zinc-500">{t('preview.noChanges')}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {trainings.create.map((item) => (
              <li key={item.key} className="flex gap-2">
                <Badge tone="green">{t('preview.badgeNew')}</Badge>
                <span className="line-clamp-2 text-zinc-700">{item.text}</span>
              </li>
            ))}
            {trainings.update.map((item) => (
              <li key={item.key} className="flex gap-2">
                <Badge tone="brand">{t('preview.badgeChanged')}</Badge>
                <span className="line-clamp-2 text-zinc-700">{item.text}</span>
              </li>
            ))}
            {trainings.remove.length > 0 && (
              <li className="flex gap-2">
                <Badge tone="amber">{t('preview.badgeRemoved')}</Badge>
                <span className="text-zinc-700">
                  {t('preview.removedItems', { count: trainings.remove.length })}
                </span>
              </li>
            )}
          </ul>
        )}
        {preview.mediaToRemove.length > 0 && (
          <p className="text-sm text-amber-700">
            {t('preview.mediaRemoved', { count: preview.mediaToRemove.length })}
          </p>
        )}
      </Card>

      <Card className="space-y-2 p-5">
        <h4 className="text-sm font-semibold text-zinc-900">{t('preview.actions')}</h4>
        <ul className="space-y-1 text-sm text-zinc-700">
          {compiled.intentions.map((intention) => {
            const created = intentions.create.some((item) => item.key === intention.key);
            const updated = intentions.update.some((item) => item.key === intention.key);
            return (
              <li key={intention.key} className="flex items-center gap-2">
                {intention.input.name}
                {created && <Badge tone="green">{t('preview.actionNew')}</Badge>}
                {updated && <Badge tone="brand">{t('preview.actionChanged')}</Badge>}
              </li>
            );
          })}
          {intentions.remove.map((key) => (
            <li key={key} className="flex items-center gap-2 text-zinc-500">
              {intentionName(key)} <Badge tone="amber">{t('preview.actionRemoved')}</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
