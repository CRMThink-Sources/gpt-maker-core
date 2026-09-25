import { describe, expect, it } from 'vitest';
import { fromGptMakerName, tenantCodeFromGptMakerName, toGptMakerName } from './agent-naming';

describe('convenção de nomes', () => {
  it('prefixa com o tenantCode', () => {
    expect(toGptMakerName('a1b2c3d4', '  Atendente Maria ')).toBe('[a1b2c3d4] Atendente Maria');
  });

  it('remove o prefixo para exibir', () => {
    expect(fromGptMakerName('[a1b2c3d4] Atendente Maria')).toBe('Atendente Maria');
  });

  it('remove só o prefixo do tenant quando o nome também tem colchetes', () => {
    const name = toGptMakerName('a1b2c3d4', '[Vendas] Bot');
    expect(name).toBe('[a1b2c3d4] [Vendas] Bot');
    expect(fromGptMakerName(name)).toBe('[Vendas] Bot');
  });

  it('mantém nome fora da convenção', () => {
    expect(fromGptMakerName('Agente criado no painel')).toBe('Agente criado no painel');
    expect(tenantCodeFromGptMakerName('Agente criado no painel')).toBeNull();
  });

  it('extrai o tenantCode', () => {
    expect(tenantCodeFromGptMakerName('[a1b2c3d4] X')).toBe('a1b2c3d4');
  });

  it('recusa nome vazio e tenantCode inválido', () => {
    expect(() => toGptMakerName('a1b2', '   ')).toThrow(/vazio/);
    expect(() => toGptMakerName('com espaço', 'X')).toThrow(/tenantCode/);
  });
});
