import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FieldCipher } from './field-cipher';

const key = () => randomBytes(32).toString('base64');

describe('FieldCipher', () => {
  const cipher = new FieldCipher(key());

  it('cifra e decifra', () => {
    const encrypted = cipher.encrypt('segredo-totp é ✓');
    expect(encrypted).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]*$/);
    expect(encrypted).not.toContain('segredo');
    expect(cipher.decrypt(encrypted)).toBe('segredo-totp é ✓');
  });

  it('usa IV aleatório', () => {
    expect(cipher.encrypt('x')).not.toBe(cipher.encrypt('x'));
  });

  it('aceita texto vazio', () => {
    expect(cipher.decrypt(cipher.encrypt(''))).toBe('');
  });

  it('detecta adulteração', () => {
    const [version, iv, tag, data] = cipher.encrypt('valor').split(':');
    const tampered = Buffer.from(data!, 'base64url');
    tampered[0] = tampered[0]! ^ 1;
    expect(() =>
      cipher.decrypt([version, iv, tag, tampered.toString('base64url')].join(':')),
    ).toThrow();
  });

  it('recusa chave diferente', () => {
    expect(() => new FieldCipher(key()).decrypt(cipher.encrypt('valor'))).toThrow();
  });

  it('recusa formato desconhecido', () => {
    expect(() => cipher.decrypt('v2:a:b:c')).toThrow(/formato/);
    expect(() => cipher.decrypt('texto puro')).toThrow(/formato/);
  });

  it('exige chave de 32 bytes', () => {
    expect(() => new FieldCipher(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
