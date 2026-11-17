import {
  TRAINING_IMPORT_MAX_ITEMS,
  type TrainingExport,
  type TrainingImportReason,
  type TrainingImportRequest,
  type TrainingInterval,
  type TrainingView,
  trainingImportRequestSchema,
} from '@gptmaker/contracts';
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
  if (status === 'EXPIRED') return { label: t('status.expired'), tone: 'zinc' };
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

/** `treinamentos-<nome-do-agente>-AAAA-MM-DD.json`, só com letras, números e hífen. */
export function trainingExportFileName(agentName: string, now: Date = new Date()): string {
  const slug =
    agentName
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '') || 'agente';
  return `treinamentos-${slug}-${now.toISOString().slice(0, 10)}.json`;
}

/** Algum item do arquivo leva o link de uma imagem (o aviso do arquivo depende disso). */
export function exportHasImages(file: TrainingExport): boolean {
  return file.trainings.some((item) => item.type === 'TEXT' && Boolean(item.imageUrl));
}

/** Baixa `data` como arquivo JSON legível pelo navegador. */
export function downloadJsonFile(data: unknown, fileName: string): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export type ImportFileCheck =
  | { ok: true; payload: TrainingImportRequest; count: number; withImages: number }
  | { ok: false; reason: 'NOT_JSON' | 'INVALID' | 'VERSION' | 'TOO_MANY' };

/**
 * Confere o texto do arquivo escolhido antes de chamar a API (o servidor refaz a validação): só
 * a forma geral; cada item é validado lá, para um item ruim não derrubar os demais.
 */
export function checkImportFile(text: string): ImportFileCheck {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'NOT_JSON' };
  }
  const parsed = trainingImportRequestSchema.safeParse(json);
  if (parsed.success) {
    const withImages = parsed.data.trainings.filter(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { imageUrl?: unknown }).imageUrl === 'string',
    ).length;
    return { ok: true, payload: parsed.data, count: parsed.data.trainings.length, withImages };
  }
  const record = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
  if ('version' in record && record['version'] !== 1) return { ok: false, reason: 'VERSION' };
  const list = record['trainings'];
  if (Array.isArray(list) && list.length > TRAINING_IMPORT_MAX_ITEMS) {
    return { ok: false, reason: 'TOO_MANY' };
  }
  return { ok: false, reason: 'INVALID' };
}

/** Motivo de um item da importação: traduzido pelo código quando houver, senão o texto da API. */
export function importReasonText(reason: TrainingImportReason, t: T): string {
  const key = `import.reasons.${reason.code}`;
  return t.has(key) ? t(key) : reason.message;
}
