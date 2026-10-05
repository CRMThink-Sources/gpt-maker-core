import { describe, expect, it } from 'vitest';
import { fromGptMakerName, tenantCodeFromGptMakerName } from './agent-naming';

describe('prefixo legado no nome', () => {
  it('remove o prefixo', () => {
    expect(fromGptMakerName('[a1b2c3d4] Atendente Maria')).toBe('Atendente Maria');
  });

  it('remove só o primeiro par de colchetes', () => {
    expect(fromGptMakerName('[a1b2c3d4] [Vendas] Bot')).toBe('[Vendas] Bot');
  });

  it('mantém nome sem prefixo', () => {
    expect(fromGptMakerName('Agente criado no painel')).toBe('Agente criado no painel');
    expect(tenantCodeFromGptMakerName('Agente criado no painel')).toBeNull();
  });

  it('extrai o tenantCode', () => {
    expect(tenantCodeFromGptMakerName('[a1b2c3d4] X')).toBe('a1b2c3d4');
  });
});
