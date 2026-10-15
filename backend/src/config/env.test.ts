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
    expect(loadEnv(base)).toMatchObject({ CRM_TOOLS_ENABLED: false, CRM_TOOLS_RATE_PER_MINUTE: 60 });
    expect(
      loadEnv({ ...base, CRM_TOOLS_ENABLED: 'true', CRM_TOOLS_RATE_PER_MINUTE: '30' }),
    ).toMatchObject({ CRM_TOOLS_ENABLED: true, CRM_TOOLS_RATE_PER_MINUTE: 30 });
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
