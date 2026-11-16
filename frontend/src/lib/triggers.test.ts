import type { TriggerExecutionView } from '@gptmaker/contracts';
import { describe, expect, it } from 'vitest';
import { createT } from '@/i18n';
import {
  actionType,
  agentEvent,
  executionStatus,
  newAction,
  resultSummary,
  templateErrorMessage,
} from './triggers';

const pt = createT('pt-BR', 'triggers');
const en = createT('en', 'triggers');
const es = createT('es', 'triggers');

const execution = (result: Record<string, unknown> | null) =>
  ({ result }) as unknown as TriggerExecutionView;

describe('rótulos de gatilhos', () => {
  it('traduz eventos e ações em cada idioma', () => {
    expect(agentEvent(pt, 'onNewMessage').label).toBe('Nova mensagem');
    expect(agentEvent(en, 'onNewMessage').label).toBe('New message');
    expect(actionType(es, 'CREATE_TASK').label).toBe('Crear tarea');
  });

  it('traduz o estado da execução', () => {
    expect(executionStatus(pt, 'FAILED')).toEqual({ label: 'Falhou', tone: 'amber' });
    expect(executionStatus(en, 'SUCCESS').label).toBe('Executed');
  });
});

describe('resultSummary', () => {
  it.each([
    [{ leadId: 7 }, 'Lead #7', 'Lead #7'],
    [{ dealId: 3, created: true }, 'Negócio #3 (novo)', 'Deal #3 (new)'],
    [{ dealId: 3 }, 'Negócio #3', 'Deal #3'],
    [{ status: 200 }, 'HTTP 200', 'HTTP 200'],
  ])('resume %j', (result, esperadoPt, esperadoEn) => {
    expect(resultSummary(pt, execution(result))).toBe(esperadoPt);
    expect(resultSummary(en, execution(result))).toBe(esperadoEn);
  });

  it('sem resultado conhecido não resume', () => {
    expect(resultSummary(pt, execution(null))).toBeNull();
  });
});

describe('newAction', () => {
  it('mantém as chaves {{ }} dos textos iniciais em qualquer idioma', () => {
    for (const t of [pt, en, es]) {
      const action = newAction(t, 'CREATE_LEAD');
      expect(action.type === 'CREATE_LEAD' && action.config.fields.TITLE).toMatch(
        /\{\{contact\.name \| ".+"\}\}/,
      );
    }
    const comment = newAction(pt, 'TIMELINE_COMMENT');
    expect(comment.type === 'TIMELINE_COMMENT' && comment.config.text).toBe(
      'Atendimento do agente {{agent.name}}: {{event.name}}',
    );
  });
});

describe('templateErrorMessage', () => {
  it('traduz os erros do contrato e preserva os desconhecidos', () => {
    expect(templateErrorMessage(en, 'variável desconhecida: {{x}}')).toBe(
      'unknown variable: {{x}}',
    );
    expect(templateErrorMessage(en, 'chaves {{ }} sem par')).toBe('unmatched {{ }} braces');
    expect(templateErrorMessage(pt, 'outro erro')).toBe('outro erro');
  });
});
