import { Global, Module } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { ObjectStorage } from './object-storage';

/** Armazenamento de objetos (documentos de treinamento), design D14. */
@Global()
@Module({
  providers: [
    {
      provide: ObjectStorage,
      inject: [ENV],
      useFactory: (env: Env) =>
        new ObjectStorage({
          endpoint: env.STORAGE_ENDPOINT,
          publicEndpoint: env.STORAGE_PUBLIC_ENDPOINT,
          region: env.STORAGE_REGION,
          bucket: env.STORAGE_BUCKET,
          accessKeyId: env.STORAGE_ACCESS_KEY,
          secretAccessKey: env.STORAGE_SECRET_KEY,
          forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
          presignTtlSeconds: env.STORAGE_PRESIGN_TTL_SECONDS,
        }),
    },
  ],
  exports: [ObjectStorage],
})
export class StorageModule {}
