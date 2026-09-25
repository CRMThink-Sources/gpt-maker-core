import type { NextFunction, Request, Response } from 'express';
import { runWithContext, traceIdFromHeaders } from './request-context';

/** Primeiro middleware do Express: abre o contexto da requisição e devolve o trace id. */
export function contextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceId = traceIdFromHeaders(req.headers);
  res.setHeader('x-trace-id', traceId);
  runWithContext({ traceId }, next);
}
