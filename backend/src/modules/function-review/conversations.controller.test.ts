import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { AppSessionGuard } from '../tenancy';
import { ConversationsController } from './conversations.controller';

// O guard decide o acesso pelo nível gravado em `@AppAuth` (ver app-session.guard.test.ts); aqui
// se garante que as rotas de conversas pedem `manage` (spec agent-hallucination-analysis).
const handler = (name: keyof ConversationsController) => ConversationsController.prototype[name];
const access = (name: keyof ConversationsController) =>
  Reflect.getMetadata('app:access', handler(name)) as string | undefined;
const guards = (name: keyof ConversationsController) =>
  (Reflect.getMetadata('__guards__', handler(name)) ?? []) as unknown[];

describe('rotas de conversas para análise', () => {
  it.each(['list', 'messages'] as const)('%s exige permissão de gerenciar', (name) => {
    expect(access(name)).toBe('manage');
    expect(guards(name)).toContain(AppSessionGuard);
  });

  it('ficam sob o agente do tenant da sessão', () => {
    expect(Reflect.getMetadata('path', ConversationsController)).toBe(
      'app/agents/:id/conversations',
    );
    expect(Reflect.getMetadata('path', handler('messages'))).toBe(':conversationId/messages');
  });
});
