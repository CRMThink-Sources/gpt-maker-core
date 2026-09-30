import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface ObjectStorageOptions {
  endpoint: string;
  /** Host das URLs pré-assinadas (entra na assinatura); padrão: `endpoint`. */
  publicEndpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  presignTtlSeconds: number;
}

export interface PutObjectInput {
  key: string;
  body: Buffer | Readable;
  contentType: string;
  contentLength: number;
  /** Nome original, devolvido no download (`Content-Disposition`). */
  fileName: string;
}

/**
 * Objetos no DigitalOcean Spaces, S3 compatível (SeaweedFS em dev), design D14. Os documentos de
 * treinamento ficam privados; o GPTMaker os baixa por URL pré-assinada. A chave é aleatória, sem
 * o nome do arquivo, para a URL não revelar nada e não ser adivinhável.
 */
export class ObjectStorage {
  private readonly client: S3Client;
  private readonly signer: S3Client;

  constructor(private readonly options: ObjectStorageOptions) {
    const config = {
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      // Spaces e SeaweedFS não aceitam os checksums novos que o SDK passou a enviar por padrão.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    } as const;
    this.client = new S3Client({ ...config, endpoint: options.endpoint });
    this.signer =
      options.publicEndpoint && options.publicEndpoint !== options.endpoint
        ? new S3Client({ ...config, endpoint: options.publicEndpoint })
        : this.client;
  }

  /** `trainings/<tenantId>/<aleatório>.<extensão>`: prefixo por tenant só para manutenção. */
  newTrainingKey(tenantId: string, fileName: string): string {
    const extension = /\.([a-z0-9]{1,10})$/i.exec(fileName)?.[1]?.toLowerCase();
    const random = randomBytes(24).toString('base64url');
    return `trainings/${tenantId}/${random}${extension ? `.${extension}` : ''}`;
  }

  async put(input: PutObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: input.contentLength,
        ContentDisposition: contentDisposition(input.fileName),
      }),
    );
  }

  /** URL de leitura com validade de `presignTtlSeconds` (até 7 dias, limite do SigV4). */
  presignedUrl(key: string): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      { expiresIn: this.options.presignTtlSeconds },
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }));
      return true;
    } catch (error) {
      if (error instanceof NotFound) return false;
      throw error;
    }
  }

  /** Idempotente: remover objeto inexistente não é erro no S3. */
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }
}

/** `attachment` com o nome em ASCII e em UTF-8 (RFC 6266), para acentos e espaços. */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
