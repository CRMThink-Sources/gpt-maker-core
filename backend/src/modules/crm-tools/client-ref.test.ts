import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ClientRefs } from './client-ref';

const refs = new ClientRefs(randomBytes(32));

describe('ClientRefs', () => {
  it('ida e volta', () => {
    const ref = refs.issue('t1', 'contact', 123);
    expect(ref).toMatch(/^c123\.[A-Za-z0-9_-]{22}$/);
    expect(refs.verify('t1', ref)).toEqual({ type: 'contact', id: 123 });
    expect(refs.verify('t1', refs.issue('t1', 'lead', 9))).toEqual({ type: 'lead', id: 9 });
    expect(refs.verify('t1', refs.issue('t1', 'company', 4))).toEqual({ type: 'company', id: 4 });
  });

  it('recusa referência adulterada', () => {
    const ref = refs.issue('t1', 'contact', 123);
    expect(refs.verify('t1', ref.replace('c123', 'c124'))).toBeNull();
    expect(refs.verify('t1', ref.replace('c123', 'l123'))).toBeNull();
    // Troca no meio da assinatura e em cada valor possível do último caractere (bits de enchimento).
    const swap = (index: number, char: string) =>
      `${ref.slice(0, index)}${char}${ref.slice(index + 1)}`;
    const middle = ref.length - 10;
    expect(refs.verify('t1', swap(middle, ref[middle] === 'A' ? 'B' : 'A'))).toBeNull();
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (const char of alphabet.replace(ref.at(-1)!, '')) {
      expect(refs.verify('t1', swap(ref.length - 1, char))).toBeNull();
    }
    expect(refs.verify('t1', 'c123')).toBeNull();
    expect(refs.verify('t1', 123)).toBeNull();
  });

  it('referência de outro tenant não vale', () => {
    expect(refs.verify('t2', refs.issue('t1', 'contact', 123))).toBeNull();
  });

  it('outra chave não vale', () => {
    expect(new ClientRefs(randomBytes(32)).verify('t1', refs.issue('t1', 'contact', 1))).toBeNull();
  });
});
