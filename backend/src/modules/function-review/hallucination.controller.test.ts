import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { AppSessionGuard } from '../tenancy';
import { HallucinationController } from './hallucination.controller';

// O guard decide o acesso pelo nível gravado em `@AppAuth` (ver app-session.guard.test.ts); aqui
// se garante que a rota da análise pede `manage` (spec agent-hallucination-analysis).
const handler = HallucinationController.prototype.analyze;

describe('rota da análise de alucinação', () => {
  it('exige permissão de gerenciar: consulta é recusada pelo guard', () => {
    expect(Reflect.getMetadata('app:access', handler)).toBe('manage');
    expect(Reflect.getMetadata('__guards__', handler)).toContain(AppSessionGuard);
  });

  it('fica sob a função do agente do tenant da sessão', () => {
    expect(Reflect.getMetadata('path', HallucinationController)).toBe(
      'app/agents/:id/function/hallucination',
    );
  });
});
