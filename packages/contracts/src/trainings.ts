import { z } from 'zod';

export const trainingTypeSchema = z.enum(['TEXT', 'WEBSITE', 'VIDEO', 'DOCUMENT']);
export const trainingStatusSchema = z.enum(['PROCESSING', 'DONE', 'FAILED', 'EXPIRED']);

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

/** Tamanho máximo do texto de um treinamento (criação e edição). */
export const TRAINING_TEXT_MAX = 1028;

/** Limites das tags de um treinamento (spec training-tags). */
export const TRAINING_TAG_MAX_LENGTH = 30;
export const TRAINING_TAGS_MAX = 10;

/** Aparar, colapsar espaços, minúsculas, descartar vazias e duplicatas (spec training-tags). */
export function normalizeTrainingTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const tag of tags) {
    const normalized = tag.trim().replace(/\s+/g, ' ').toLowerCase();
    if (normalized) seen.add(normalized);
  }
  return [...seen];
}

/** Tags já normalizadas; recusa tag grande demais ou lista acima do limite. */
export const trainingTagsSchema = z
  .array(z.string())
  .max(TRAINING_TAGS_MAX * 5, 'lista de tags grande demais')
  .transform(normalizeTrainingTags)
  .pipe(
    z
      .array(
        z
          .string()
          .max(
            TRAINING_TAG_MAX_LENGTH,
            `cada tag tem no máximo ${TRAINING_TAG_MAX_LENGTH} caracteres`,
          ),
      )
      .max(TRAINING_TAGS_MAX, `no máximo ${TRAINING_TAGS_MAX} tags`),
  );

/** Tolerância para o relógio do navegador estar atrasado em relação ao servidor. */
const EXPIRES_AT_CLOCK_SKEW_MS = 60_000;

/** Data de expiração (ISO 8601) que ainda não passou (spec training-expiration). */
export const trainingExpiresAtSchema = z.iso
  .datetime({ offset: true })
  .refine((value) => Date.parse(value) > Date.now() - EXPIRES_AT_CLOCK_SKEW_MS, {
    message: 'a data de expiração precisa ser futura',
  });

/** Imagem de treinamento de texto (spec agent-training-image). */
export const TRAINING_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const TRAINING_IMAGE_MIMETYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type TrainingImageMimetype = (typeof TRAINING_IMAGE_MIMETYPES)[number];

/** Treinamentos sem arquivo; a imagem do texto é enviada antes (`imageId`). */
export const createTrainingSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('TEXT'),
    text: z.string().trim().min(1).max(TRAINING_TEXT_MAX),
    imageId: z.uuid().optional(),
    tags: trainingTagsSchema.optional(),
    expiresAt: trainingExpiresAtSchema.optional(),
  }),
  z.object({
    type: z.literal('WEBSITE'),
    url: httpUrl,
    /** Treina também as páginas ligadas a partir desta. */
    trainingSubPages: z.boolean().default(false),
    trainingInterval: trainingIntervalSchema.default('NEVER'),
    tags: trainingTagsSchema.optional(),
    expiresAt: trainingExpiresAtSchema.optional(),
  }),
  z.object({
    type: z.literal('VIDEO'),
    url: httpUrl,
    tags: trainingTagsSchema.optional(),
    expiresAt: trainingExpiresAtSchema.optional(),
  }),
]);
export type CreateTrainingInput = z.input<typeof createTrainingSchema>;

/**
 * Só treinamentos de texto são editáveis; os demais são removidos e criados de novo. `imageId`
 * ausente mantém a imagem; `null` a remove.
 */
export const updateTrainingSchema = z
  .object({
    text: z.string().trim().min(1).max(TRAINING_TEXT_MAX),
    imageId: z.uuid().nullable(),
  })
  .partial()
  .strict()
  .refine((input) => input.text !== undefined || input.imageId !== undefined, {
    message: 'informe o texto ou a imagem',
  });
export type UpdateTrainingInput = z.input<typeof updateTrainingSchema>;

/**
 * Ajustes que valem para qualquer tipo e não reenviam nada ao GPTMaker: tags e expiração
 * (`expiresAt: null` limpa). Ao menos um campo.
 */
export const updateTrainingSettingsSchema = z
  .object({
    tags: trainingTagsSchema,
    expiresAt: trainingExpiresAtSchema.nullable(),
  })
  .partial()
  .strict()
  .refine((input) => input.tags !== undefined || input.expiresAt !== undefined, {
    message: 'informe as tags ou a expiração',
  });
export type UpdateTrainingSettingsInput = z.input<typeof updateTrainingSettingsSchema>;

/** Uso dos limites de treinamento do plano, somando todos os agentes do tenant. */
export interface TrainingUsage {
  /** `limit` nulo: sem limite no plano. */
  trainings: { used: number; limit: number | null };
  documentBytes: { used: number; limit: number | null };
}

/** Imagem anexada a um treinamento de texto; `url` é de leitura temporária (miniatura). */
export interface TrainingImageView {
  id: string;
  url: string;
  mimetype: string;
  sizeBytes: number;
}

/** Resposta do upload de imagem. */
export type UploadedTrainingImage = TrainingImageView & { fileName: string };

export interface TrainingView {
  id: string;
  type: z.infer<typeof trainingTypeSchema>;
  status: z.infer<typeof trainingStatusSchema>;
  /** Gerado pela função do agente: só muda pelo formulário dela. */
  managed: boolean;
  /** Texto do `TEXT`. */
  text: string | null;
  /** Imagem do `TEXT`. */
  image: TrainingImageView | null;
  /** Endereço do `WEBSITE` ou do `VIDEO`. */
  url: string | null;
  trainingSubPages: boolean | null;
  trainingInterval: TrainingInterval | null;
  document: { name: string; mimetype: string; sizeBytes: number } | null;
  tags: string[];
  /** Quando o treinamento expira (ISO); nulo: sem expiração. */
  expiresAt: string | null;
  /** Quando o job o expirou (ISO); preenchido só em `EXPIRED`. */
  expiredAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export const TRAINING_PAGE_SIZE_DEFAULT = 20;
export const TRAINING_PAGE_SIZE_MAX = 100;
export const TRAINING_SEARCH_MAX = 100;

/** Lista separada por vírgula (query string) validada item a item; vazio = sem filtro. */
function csvList<T extends z.ZodType<string, string>>(item: T) {
  return z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
        : [],
    )
    .pipe(z.array(item).max(50));
}

/** Query da listagem de treinamentos do agente (spec training-listing). */
export const listTrainingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(TRAINING_PAGE_SIZE_MAX)
    .default(TRAINING_PAGE_SIZE_DEFAULT),
  q: z.string().trim().max(TRAINING_SEARCH_MAX).optional(),
  type: csvList(trainingTypeSchema),
  status: csvList(trainingStatusSchema),
  tags: csvList(z.string().max(TRAINING_TAG_MAX_LENGTH * 2)).transform(normalizeTrainingTags),
});
export type ListTrainingsQuery = z.output<typeof listTrainingsQuerySchema>;

export interface TrainingPageInfo {
  page: number;
  pageSize: number;
  /** Itens que atendem aos filtros (todas as páginas). */
  total: number;
  totalPages: number;
}

/** Resposta da listagem: página, uso do plano do tenant e tags já usadas no agente. */
export interface TrainingListResponse {
  trainings: TrainingView[];
  usage: TrainingUsage;
  page: TrainingPageInfo;
  availableTags: string[];
}

/** Máximo de itens por arquivo de importação (spec agent-training-transfer). */
export const TRAINING_IMPORT_MAX_ITEMS = 100;

/**
 * Item do arquivo de exportação: o mesmo conteúdo da criação manual, sem identificadores
 * internos. Estrito para o arquivo nunca criar treinamento `managed`, de documento ou ligar
 * imagem por id (design D5). `imageUrl` é a URL pública da imagem do texto (design D5b).
 */
export const trainingTransferItemSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('TEXT'),
    text: z.string().trim().min(1).max(TRAINING_TEXT_MAX),
    imageUrl: httpUrl.optional(),
    tags: trainingTagsSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('WEBSITE'),
    url: httpUrl,
    trainingSubPages: z.boolean().default(false),
    trainingInterval: trainingIntervalSchema.default('NEVER'),
    tags: trainingTagsSchema.optional(),
  }),
  z.strictObject({ type: z.literal('VIDEO'), url: httpUrl, tags: trainingTagsSchema.optional() }),
]);
export type TrainingTransferItem = z.infer<typeof trainingTransferItemSchema>;

/** Arquivo gerado pela exportação (`version` literal: formatos futuros são recusados). */
export const trainingExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  trainings: z.array(trainingTransferItemSchema).max(TRAINING_IMPORT_MAX_ITEMS),
});
export type TrainingExport = z.infer<typeof trainingExportSchema>;

/**
 * Envelope da importação: só a versão e o limite de itens recusam o arquivo inteiro; cada item
 * (`unknown`) é validado à parte com `trainingTransferItemSchema`, para um item inválido não
 * derrubar os demais.
 */
export const trainingImportRequestSchema = z.object({
  version: z.literal(1),
  trainings: z.array(z.unknown()).max(TRAINING_IMPORT_MAX_ITEMS),
});
export type TrainingImportRequest = z.infer<typeof trainingImportRequestSchema>;

export interface TrainingImportReason {
  code: string;
  message: string;
}

/** Resultado de um item do arquivo (`position` conta de 1, na ordem do arquivo). */
export interface TrainingImportItemResult {
  position: number;
  type: string | null;
  status: 'CREATED' | 'REJECTED' | 'FAILED';
  trainingId: string | null;
  /** Por que não foi criado (`REJECTED`/`FAILED`). */
  reason: TrainingImportReason | null;
  /** Item criado, mas sem algo do arquivo (ex.: imagem que não pôde ser copiada). */
  warnings: TrainingImportReason[];
}

export interface TrainingImportResult {
  summary: { created: number; rejected: number; failed: number; withWarnings: number };
  items: TrainingImportItemResult[];
}
