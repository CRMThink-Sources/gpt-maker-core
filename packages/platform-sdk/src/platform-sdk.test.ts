import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CODE, createSessionVerifier, verifyPlatformSignature } from './index';

// Garante que a cópia do SDK continua compatível com o formato do contrato
// (docs/crmthink-platform-openapi.json, webhook `installer`) e com o nosso uso.

function sign(secret: string, body: string, timestamp: number): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

describe('verifyPlatformSignature', () => {
  const body = '{"installationId":1001,"isReinstall":false}';
  const now = new Date('2026-09-28T12:00:00Z');
  const t = Math.floor(now.getTime() / 1000);

  it('aceita a assinatura do contrato sobre o corpo cru', () => {
    const header = sign('s1', body, t);
    expect(
      verifyPlatformSignature({ header, rawBody: Buffer.from(body), secrets: ['s1'], now }),
    ).toEqual({ ok: true });
  });

  it('aceita durante a rotação (dois v1=) com qualquer segredo vigente', () => {
    const header = `${sign('antigo', body, t)},v1=${sign('novo', body, t).split('v1=')[1]}`;
    expect(verifyPlatformSignature({ header, rawBody: body, secrets: ['novo'], now }).ok).toBe(
      true,
    );
  });

  it('recusa corpo alterado, segredo errado, fora da janela e header malformado', () => {
    const header = sign('s1', body, t);
    expect(verifyPlatformSignature({ header, rawBody: `${body} `, secrets: ['s1'], now })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
    expect(verifyPlatformSignature({ header, rawBody: body, secrets: ['s2'], now })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
    expect(
      verifyPlatformSignature({
        header: sign('s1', body, t - 301),
        rawBody: body,
        secrets: ['s1'],
        now,
      }),
    ).toEqual({ ok: false, reason: 'expired' });
    expect(
      verifyPlatformSignature({ header: 'v1=abc', rawBody: body, secrets: ['s1'], now }),
    ).toEqual({ ok: false, reason: 'malformed' });
    expect(
      verifyPlatformSignature({ header: undefined, rawBody: body, secrets: ['s1'], now }),
    ).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('createSessionVerifier (JWKS)', () => {
  let server: Server;
  let platformUrl: string;
  let privateKey: CryptoKey;

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(req.url === '/.well-known/jwks.json' ? { keys: [jwk] } : {}));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    platformUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const token = (claims: { aud?: string; iss?: string; exp?: string } = {}) =>
    new SignJWT({
      installationId: 1001,
      memberId: 'm1',
      domain: 'x.bitrix24.com.br',
      isAdmin: true,
      name: 'Ana',
      departmentIds: [1],
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject('7')
      .setAudience(claims.aud ?? APP_CODE)
      .setIssuer(claims.iss ?? platformUrl)
      .setExpirationTime(claims.exp ?? '15m')
      .sign(privateKey);

  it('valida assinatura, iss, aud e exp e devolve as claims', async () => {
    const verify = createSessionVerifier({ platformUrl, appCode: APP_CODE });
    const claims = await verify(await token());
    expect(claims).toMatchObject({ sub: '7', installationId: 1001, isAdmin: true });
  });

  it('recusa outra audiência, outro emissor e token expirado', async () => {
    const verify = createSessionVerifier({ platformUrl, appCode: APP_CODE });
    await expect(verify(await token({ aud: 'crmthink.outro' }))).rejects.toThrow();
    await expect(verify(await token({ iss: 'https://evil' }))).rejects.toThrow();
    await expect(verify(await token({ exp: '-1m' }))).rejects.toThrow();
  });
});
