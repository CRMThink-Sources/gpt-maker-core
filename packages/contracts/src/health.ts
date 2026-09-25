import { z } from 'zod';

export const healthStatusSchema = z.enum(['up', 'down']);

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  info: z.record(z.string(), z.object({ status: healthStatusSchema }).loose()).optional(),
  error: z.record(z.string(), z.object({ status: healthStatusSchema }).loose()).optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
