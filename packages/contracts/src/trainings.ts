import { z } from 'zod';

export const trainingTypeSchema = z.enum(['TEXT', 'WEBSITE', 'VIDEO', 'DOCUMENT']);
export const trainingStatusSchema = z.enum(['PROCESSING', 'DONE', 'FAILED']);

/**
 * Intervalos de re-treinamento de site oferecidos ao tenant. O GPTMaker aceita também
 * `THIRTY_SECONDS`, que não é oferecido: re-treinar a cada 30 s sobrecarrega o workspace.
 */
export const trainingIntervalSchema = z.enum([
  'NEVER',
  'ONE_HOUR',
  'FOUR_HOUR',
  'EIGHT_HOUR',
  'TWELVE_HOUR',
  'ONE_DAY',
  'ONE_WEEK',
  'ONE_MONTH',
]);
export type TrainingInterval = z.infer<typeof trainingIntervalSchema>;

const httpUrl = z
  .url({ protocol: /^https?$/, message: 'informe um endereço http ou https' })
  .max(2000);

/** Treinamentos sem arquivo; documento vai por upload (`multipart/form-data`, campo `file`). */
export const createTrainingSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TEXT'), text: z.string().trim().min(1).max(50_000) }),
  z.object({
    type: z.literal('WEBSITE'),
    url: httpUrl,
    /** Treina também as páginas ligadas a partir desta. */
    trainingSubPages: z.boolean().default(false),
    trainingInterval: trainingIntervalSchema.default('NEVER'),
  }),
  z.object({ type: z.literal('VIDEO'), url: httpUrl }),
]);
export type CreateTrainingInput = z.input<typeof createTrainingSchema>;

/** Só treinamentos de texto são editáveis; os demais são removidos e criados de novo. */
export const updateTrainingSchema = z.object({ text: z.string().trim().min(1).max(50_000) });
export type UpdateTrainingInput = z.input<typeof updateTrainingSchema>;

/**
 * Documentos aceitos, por extensão. O GPTMaker não documenta formatos nem tamanho; a lista cobre
 * os formatos de texto comuns e deve ser confirmada em staging.
 */
export const TRAINING_DOCUMENT_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
} as const;

/** Tamanho máximo de um documento de treinamento. */
export const TRAINING_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

export interface TrainingView {
  id: string;
  type: z.infer<typeof trainingTypeSchema>;
  status: z.infer<typeof trainingStatusSchema>;
  /** Texto do `TEXT`. */
  text: string | null;
  /** Endereço do `WEBSITE` ou do `VIDEO`. */
  url: string | null;
  trainingSubPages: boolean | null;
  trainingInterval: TrainingInterval | null;
  document: { name: string; mimetype: string; sizeBytes: number } | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
