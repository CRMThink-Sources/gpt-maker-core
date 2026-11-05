import { Module } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { VibecodeClient } from './vibecode.client';

@Module({
  providers: [
    {
      provide: VibecodeClient,
      inject: [ENV],
      useFactory: (env: Env) =>
        new VibecodeClient({ baseUrl: env.VIBECODE_BASE_URL, timeoutMs: env.VIBECODE_TIMEOUT_MS }),
    },
  ],
  exports: [VibecodeClient],
})
export class VibecodeModule {}
