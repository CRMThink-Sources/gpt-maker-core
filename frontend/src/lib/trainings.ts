import {
  TRAINING_DOCUMENT_MAX_BYTES,
  TRAINING_DOCUMENT_TYPES,
  type TrainingInterval,
  type TrainingView,
} from '@gptmaker/contracts';
import type { Tone } from '@/components/ui';

export const TRAINING_TYPES: Record<TrainingView['type'], string> = {
  TEXT: 'Texto',
  WEBSITE: 'Site',
  VIDEO: 'Vídeo',
  DOCUMENT: 'Documento',
};

export const TRAINING_INTERVALS: Record<TrainingInterval, string> = {
  NEVER: 'Não atualizar',
  ONE_HOUR: 'A cada hora',
  FOUR_HOUR: 'A cada 4 horas',
  EIGHT_HOUR: 'A cada 8 horas',
  TWELVE_HOUR: 'A cada 12 horas',
  ONE_DAY: 'Todo dia',
  ONE_WEEK: 'Toda semana',
  ONE_MONTH: 'Todo mês',
};

export function trainingStatus(status: TrainingView['status']): { label: string; tone: Tone } {
  if (status === 'DONE') return { label: 'Pronto', tone: 'green' };
  if (status === 'FAILED') return { label: 'Falhou', tone: 'amber' };
  return { label: 'Processando', tone: 'brand' };
}

/** Título curto da linha: começo do texto, endereço ou nome do arquivo. */
export function trainingTitle(training: TrainingView): string {
  if (training.type === 'TEXT') {
    const text = (training.text ?? '').replace(/\s+/g, ' ').trim();
    return text.length > 120 ? `${text.slice(0, 120)}…` : text || 'Texto';
  }
  if (training.type === 'DOCUMENT') return training.document?.name ?? 'Documento';
  return training.url ?? TRAINING_TYPES[training.type];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export const ACCEPTED_EXTENSIONS = Object.keys(TRAINING_DOCUMENT_TYPES);

/** Mesma checagem rápida do servidor (extensão e tamanho), antes de enviar. */
export function documentProblem(file: File): string | null {
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (!extension || !ACCEPTED_EXTENSIONS.includes(extension)) {
    return `Formato não aceito. Envie ${ACCEPTED_EXTENSIONS.join(', ')}.`;
  }
  if (file.size === 0) return 'O arquivo está vazio.';
  if (file.size > TRAINING_DOCUMENT_MAX_BYTES) {
    return `O arquivo passa do limite de ${formatBytes(TRAINING_DOCUMENT_MAX_BYTES)}.`;
  }
  return null;
}
