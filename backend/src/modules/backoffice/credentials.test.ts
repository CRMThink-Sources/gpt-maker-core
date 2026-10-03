import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  hashPassword,
  newTotpSecret,
  otpauthUrl,
  temporaryPassword,
  totpCode,
  verifyPassword,
  verifyTotp,
} from './credentials';

describe('senha (scrypt)', () => {
  it('confere a senha certa e recusa a errada; hash diferente a cada vez', async () => {
    const hash = await hashPassword('correta-123');
    expect(hash.startsWith('scrypt$131072$8$1$')).toBe(true);
    expect(await verifyPassword('correta-123', hash)).toBe(true);
    expect(await verifyPassword('errada-123', hash)).toBe(false);
    expect(await hashPassword('correta-123')).not.toBe(hash);
    expect(await verifyPassword('x', 'lixo')).toBe(false);
  });

  it('senha temporária: 20 caracteres sem ambíguos', () => {
    const password = temporaryPassword();
    expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{20}$/);
  });
});

describe('TOTP (RFC 6238)', () => {
  // Vetores da RFC 6238, apêndice B (SHA1, segredo ASCII "12345678901234567890"), 6 dígitos.
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('t=%i ⇒ %s', (seconds, code) => {
    expect(totpCode(secret, Math.floor(seconds / 30))).toBe(code);
  });

  it('base32 ida e volta', () => {
    const data = Buffer.from('qualquer coisa \x00\xff');
    expect(base32Decode(base32Encode(data))).toEqual(data);
    expect(newTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('aceita um passo de diferença no relógio; recusa mais que isso e formato errado', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(secret, totpCode(secret, step), now)).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(secret, step - 2), now)).toBeNull();
    expect(verifyTotp(secret, '12345', now)).toBeNull();
  });

  it('link otpauth para o QR code', () => {
    expect(otpauthUrl('ThinkFlow AI', 'ana@x.com', 'ABC')).toBe(
      'otpauth://totp/ThinkFlow%20AI%3Aana%40x.com?secret=ABC&issuer=ThinkFlow+AI&algorithm=SHA1&digits=6&period=30',
    );
  });
});
