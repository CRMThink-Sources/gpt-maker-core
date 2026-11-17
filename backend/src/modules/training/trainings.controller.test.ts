import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { AppSessionGuard } from '../tenancy';
import { TrainingsController } from './trainings.controller';

// O guard decide o acesso pelo nível gravado em `@AppAuth` (ver app-session.guard.test.ts); aqui
// se garante que as rotas de transferência pedem o nível certo (spec agent-training-transfer).
const handler = (name: keyof TrainingsController) => TrainingsController.prototype[name];
const access = (name: keyof TrainingsController) =>
  Reflect.getMetadata('app:access', handler(name)) as string | undefined;
const guards = (name: keyof TrainingsController) =>
  (Reflect.getMetadata('__guards__', handler(name)) ?? []) as unknown[];

describe('rotas de exportar e importar treinamentos', () => {
  it('exportar é de leitura: perfil somente consulta pode', () => {
    expect(access('export')).toBe('read');
    expect(guards('export')).toContain(AppSessionGuard);
  });

  it('importar exige permissão de gerenciar: consulta é recusada pelo guard', () => {
    expect(access('import')).toBe('manage');
    expect(guards('import')).toContain(AppSessionGuard);
  });

  it('as rotas ficam sob o agente do tenant da sessão', () => {
    expect(Reflect.getMetadata('path', TrainingsController)).toBe('app/agents/:agentId/trainings');
    expect(Reflect.getMetadata('path', handler('export'))).toBe('export');
    expect(Reflect.getMetadata('path', handler('import'))).toBe('import');
  });
});
