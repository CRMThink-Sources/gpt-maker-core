import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { AiKeyController } from './ai-key.controller';

/** Chave do metadado que `AppAuth` grava (app-session.guard.ts). */
const ACCESS = 'app:access';

const access = (handler: keyof AiKeyController) =>
  Reflect.getMetadata(ACCESS, AiKeyController.prototype[handler]);

describe('acesso às rotas da chave de IA', () => {
  it('salvar e remover são só do admin do portal', () => {
    expect(access('save')).toBe('admin');
    expect(access('remove')).toBe('admin');
  });

  it('ver o estado serve a quem edita a função, não só ao admin', () => {
    expect(access('view')).toBe('manage');
  });
});
