import { randomUUID } from 'node:crypto';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectStorage, type ObjectStorageOptions } from '../../src/shared/storage/object-storage';

const BUCKET = 'gptmaker-trainings';
const CREDENTIALS = { accessKeyId: 'test', secretAccessKey: 'test-secret' };

// Mesmo servidor S3 do docker-compose de dev (SeaweedFS), no lugar do DigitalOcean Spaces.
describe('armazenamento de objetos (S3)', () => {
  let container: StartedTestContainer;
  let port: number;
  let options: ObjectStorageOptions;
  let storage: ObjectStorage;

  const put = (
    key: string,
    content = 'conteúdo do documento',
    fileName = 'Política de trocas.pdf',
  ) =>
    storage.put({
      key,
      body: Buffer.from(content),
      contentType: 'application/pdf',
      contentLength: Buffer.byteLength(content),
      fileName,
    });

  beforeAll(async () => {
    container = await new GenericContainer('chrislusf/seaweedfs:latest')
      .withCommand(['server', '-dir=/data', '-s3', '-s3.port=8333', '-s3.config=/etc/s3.json'])
      .withCopyContentToContainer([
        {
          target: '/etc/s3.json',
          content: JSON.stringify({
            identities: [
              {
                name: 'test',
                credentials: [
                  { accessKey: CREDENTIALS.accessKeyId, secretKey: CREDENTIALS.secretAccessKey },
                ],
                actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
              },
            ],
          }),
        },
      ])
      .withExposedPorts(8333)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();
    port = container.getMappedPort(8333);
    options = {
      endpoint: `http://localhost:${port}`,
      region: 'us-east-1',
      bucket: BUCKET,
      accessKeyId: CREDENTIALS.accessKeyId,
      secretAccessKey: CREDENTIALS.secretAccessKey,
      forcePathStyle: true,
      presignTtlSeconds: 3600,
    };
    const admin = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: true,
      credentials: CREDENTIALS,
    });
    // O gateway S3 sobe depois da porta: tenta criar o bucket até aceitar.
    for (let attempt = 0; ; attempt++) {
      try {
        await admin.send(new CreateBucketCommand({ Bucket: BUCKET }));
        break;
      } catch (error) {
        if (attempt >= 30) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    storage = new ObjectStorage(options);
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  it('gera chaves aleatórias por tenant, com a extensão e sem o nome do arquivo', () => {
    const tenantId = randomUUID();
    const first = storage.newTrainingKey(tenantId, 'Política de Trocas.PDF');
    const second = storage.newTrainingKey(tenantId, 'Política de Trocas.PDF');

    expect(first).toMatch(new RegExp(`^trainings/${tenantId}/[A-Za-z0-9_-]{32}\\.pdf$`));
    expect(first).not.toBe(second);
    expect(first).not.toContain('Trocas');
    expect(storage.newTrainingKey(tenantId, 'sem-extensao')).toMatch(/\/[A-Za-z0-9_-]{32}$/);
  });

  it('grava e baixa pela URL pré-assinada, com o nome original no download', async () => {
    const key = storage.newTrainingKey(randomUUID(), 'Política de trocas.pdf');
    await put(key);

    expect(await storage.exists(key)).toBe(true);
    const response = await fetch(await storage.presignedUrl(key));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('conteúdo do documento');
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toContain(
      `filename*=UTF-8''${encodeURIComponent('Política de trocas.pdf')}`,
    );
  });

  it('assina com o endpoint público quando ele difere do interno', async () => {
    const key = storage.newTrainingKey(randomUUID(), 'a.txt');
    await put(key, 'público');
    const publicStorage = new ObjectStorage({
      ...options,
      publicEndpoint: `http://127.0.0.1:${port}`,
    });

    const url = new URL(await publicStorage.presignedUrl(key));
    expect(url.host).toBe(`127.0.0.1:${port}`);
    expect(await (await fetch(url)).text()).toBe('público');
  });

  it('URL vencida é recusada', async () => {
    const key = storage.newTrainingKey(randomUUID(), 'a.txt');
    await put(key);
    const url = await new ObjectStorage({ ...options, presignTtlSeconds: 1 }).presignedUrl(key);

    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect((await fetch(url)).status).toBe(403);
  });

  it('URL adulterada é recusada', async () => {
    const key = storage.newTrainingKey(randomUUID(), 'a.txt');
    await put(key);
    const other = storage.newTrainingKey(randomUUID(), 'b.txt');
    await put(other, 'outro tenant');

    const url = new URL(await storage.presignedUrl(key));
    url.pathname = `/${BUCKET}/${other}`;
    expect((await fetch(url)).status).toBe(403);
  });

  it('remove o objeto; remover de novo não é erro', async () => {
    const key = storage.newTrainingKey(randomUUID(), 'a.txt');
    await put(key);

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });
});
