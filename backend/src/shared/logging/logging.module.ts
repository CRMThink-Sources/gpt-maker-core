import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { currentContext } from '../context/request-context';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          base: { role: env.APP_ROLE },
          // Campos do contexto (traceId, tenantId, agentId, dialogId) em todo log.
          mixin: () => ({ ...currentContext() }),
          genReqId: (req) => currentContext()?.traceId ?? String(req.id),
          autoLogging: {
            ignore: (req) => req.url?.startsWith('/health') === true || req.url === '/metrics',
          },
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-platform-signature"]',
          ],
          transport: env.LOG_PRETTY
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        },
      }),
    }),
  ],
})
export class LoggingModule {}
