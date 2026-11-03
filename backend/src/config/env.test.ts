import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  RABBITMQ_URL: 'amqp://u:p@localhost:5672',
  DATA_ENCRYPTION_KEY: 'a2V5',
  GPTMAKER_API_TOKEN: 'token',
  GPTMAKER_WORKSPACE_ID: 'ws',
  APP_CODE: 'crmthink.thinkflow',
  PLATFORM_URL: 'https://platform.exemplo.com.br',
  PLATFORM_API_KEY: 'key',
  PLATFORM_WEBHOOK_SECRETS: 's1',
  STORAGE_ENDPOINT: 'http://localhost:8333',
  STORAGE_ACCESS_KEY: 'k',
  STORAGE_SECRET_KEY: 's',
};

describe('loadEnv', () => {
  it('aplica padrões', () => {
    const env = loadEnv(base);
    expect(env.APP_ROLE).toBe('api');
    expect(env.PORT).toBe(3001);
    expect(env.LOG_PRETTY).toBe(false);
  });

  it('converte tipos', () => {
    const env = loadEnv({ ...base, APP_ROLE: 'worker', PORT: '8080', LOG_PRETTY: 'true' });
    expect(env).toMatchObject({ APP_ROLE: 'worker', PORT: 8080, LOG_PRETTY: true });
  });

  it('ferramentas do CRM desligadas por padrão', () => {
    expect(loadEnv(base)).toMatchObject({
      CRM_TOOLS_ENABLED: false,
      CRM_TOOLS_RATE_PER_MINUTE: 60,
    });
    expect(
      loadEnv({ ...base, CRM_TOOLS_ENABLED: 'true', CRM_TOOLS_RATE_PER_MINUTE: '30' }),
    ).toMatchObject({ CRM_TOOLS_ENABLED: true, CRM_TOOLS_RATE_PER_MINUTE: 30 });
  });

  it('revisão por IA: padrões e sem chave da CRMThink', () => {
    expect(loadEnv(base)).toMatchObject({
      VIBECODE_BASE_URL: 'https://vibecode.bitrix24.com',
      VIBECODE_REVIEW_MODEL: 'bitrix/bitrixgpt-5.5',
      VIBECODE_PLATFORM_RPM: 20,
      VIBECODE_TIMEOUT_MS: 60_000,
      REVIEW_CREDITS_PER_FIELD: 2,
    });
    expect(loadEnv(base).VIBECODE_PLATFORM_API_KEY).toBeUndefined();
    // `VIBECODE_PLATFORM_API_KEY=` no .env conta como ausente.
    expect(loadEnv({ ...base, VIBECODE_PLATFORM_API_KEY: '  ' }).VIBECODE_PLATFORM_API_KEY).toBe(
      undefined,
    );
  });

  it('revisão por IA: lê as variáveis', () => {
    expect(
      loadEnv({
        ...base,
        VIBECODE_PLATFORM_API_KEY: ' vibe_api_abc ',
        VIBECODE_PLATFORM_RPM: '10',
        VIBECODE_REVIEW_MODEL: 'bitrix/outro',
        REVIEW_CREDITS_PER_FIELD: '0',
      }),
    ).toMatchObject({
      VIBECODE_PLATFORM_API_KEY: 'vibe_api_abc',
      VIBECODE_PLATFORM_RPM: 10,
      VIBECODE_REVIEW_MODEL: 'bitrix/outro',
      REVIEW_CREDITS_PER_FIELD: 0,
    });
    expect(() => loadEnv({ ...base, VIBECODE_PLATFORM_RPM: '0' })).toThrow(/VIBECODE_PLATFORM_RPM/);
    expect(() => loadEnv({ ...base, REVIEW_CREDITS_PER_FIELD: '-1' })).toThrow(
      /REVIEW_CREDITS_PER_FIELD/,
    );
  });

  it('lista variáveis ausentes', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it('separa os segredos de webhook da plataforma (rotação)', () => {
    expect(
      loadEnv({ ...base, PLATFORM_WEBHOOK_SECRETS: 'novo, antigo' }).PLATFORM_WEBHOOK_SECRETS,
    ).toEqual(['novo', 'antigo']);
    expect(() => loadEnv({ ...base, PLATFORM_WEBHOOK_SECRETS: ' , ' })).toThrow(
      /PLATFORM_WEBHOOK_SECRETS/,
    );
  });

  it('recusa papel desconhecido', () => {
    expect(() => loadEnv({ ...base, APP_ROLE: 'cron' })).toThrow(/APP_ROLE/);
  });
});
