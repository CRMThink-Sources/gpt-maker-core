import { type TrainingInterval, type TrainingView } from '@gptmaker/contracts';
import type { Tone } from '@/components/ui';
import type { createFormat, T } from '@/i18n';

/** `t` é do namespace `trainings`. */
export function trainingTypeLabel(type: TrainingView['type'], t: T): string {
  return t(`types.${type}`);
}

export const TRAINING_INTERVAL_KEYS: TrainingInterval[] = [
  'NEVER',
  'ONE_HOUR',
  'FOUR_HOUR',
  'EIGHT_HOUR',
  'TWELVE_HOUR',
  'ONE_DAY',
  'ONE_WEEK',
  'ONE_MONTH',
];

export function trainingIntervalLabel(interval: TrainingInterval, t: T): string {
  return t(`intervals.${interval}`);
}

export function trainingStatus(
  status: TrainingView['status'],
  t: T,
): { label: string; tone: Tone } {
  if (status === 'DONE') return { label: t('status.done'), tone: 'green' };
  if (status === 'FAILED') return { label: t('status.failed'), tone: 'amber' };
  return { label: t('status.processing'), tone: 'brand' };
}

/** Título curto da linha: começo do texto, endereço ou nome do arquivo. */
export function trainingTitle(training: TrainingView, t: T): string {
  if (training.type === 'TEXT') {
    const text = (training.text ?? '').replace(/\s+/g, ' ').trim();
    return text.length > 120 ? `${text.slice(0, 120)}…` : text || t('types.TEXT');
  }
  if (training.type === 'DOCUMENT') return training.document?.name ?? t('types.DOCUMENT');
  return training.url ?? t(`types.${training.type}`);
}

export function formatBytes(bytes: number, format: ReturnType<typeof createFormat>): string {
  if (bytes < 1024) return `${format.number(bytes)} B`;
  if (bytes < 1024 * 1024) return `${format.number(Math.round(bytes / 1024))} KB`;
  return `${format.number(bytes / 1024 / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}
