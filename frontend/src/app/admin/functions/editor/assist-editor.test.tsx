import type { FunctionTemplateDraft } from '@gptmaker/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { TemplateEditor, useLiveTemplate } from './template-editor';

afterEach(cleanup);

function makeDraft(extra: Partial<FunctionTemplateDraft> = {}): FunctionTemplateDraft {
  return {
    agentType: 'SUPPORT',
    settings: { enabledHumanTransfer: true, limitSubjects: true },
    profile: { jobName: 'x', jobDescription: 'y', jobSite: '' },
    blocks: [],
    crmAccess: false,
    fields: [
      {
        kind: 'TEXT',
        id: 'funcao.sobre',
        label: 'Sobre',
        required: false,
        maxLength: 300,
        multiline: true,
      },
    ],
    behavior: '{{funcao.sobre}}',
    intentions: [],
    transfers: [],
    ...extra,
  } as FunctionTemplateDraft;
}

let latest: FunctionTemplateDraft;

function Harness({ initial }: { initial: FunctionTemplateDraft }) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => {
    latest = draft;
  });
  const blocks = new Map();
  const live = useLiveTemplate(draft, blocks);
  return (
    <TemplateEditor
      draft={draft}
      live={live}
      onChange={setDraft}
      published={{}}
      publishedIntentions={[]}
      blocks={blocks}
      prefix="funcao"
      answers={{}}
      onAnswers={() => {}}
      agentName="Agente"
      onAgentName={() => {}}
      identity={null}
      versions={{ count: 0, content: null }}
    />
  );
}

const goTab = (name: string) =>
  fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }));
const openField = () => {
  goTab('Formulário');
  const expand = screen.queryByRole('button', { name: 'Expandir' });
  if (expand) fireEvent.click(expand);
};

const questionInput = () => screen.getByLabelText('Nova pergunta') as HTMLInputElement;
const addQuestion = (text: string) => {
  fireEvent.change(questionInput(), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar pergunta à ajuda' }));
};
const assistOf = () => (latest.fields[0] as { assist?: unknown }).assist;

describe('editor da ajuda da IA', () => {
  it('adds and removes questions up to 5', () => {
    render(<Harness initial={makeDraft()} />);
    openField();
    for (let n = 1; n <= 5; n++) addQuestion(`Pergunta ${n}`);
    expect(assistOf()).toEqual({
      questions: ['P1', 'P2', 'P3', 'P4', 'P5'].map((_, i) => `Pergunta ${i + 1}`),
    });
    expect(screen.queryByLabelText('Nova pergunta')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Remover pergunta da ajuda' })[0]!);
    expect((assistOf() as { questions: string[] }).questions).toHaveLength(4);
    expect(screen.getByLabelText('Nova pergunta')).toBeTruthy();
    expect(screen.getByLabelText('Nova pergunta').getAttribute('maxlength')).toBe('200');
  });

  it('removing all questions drops assist from the field', () => {
    render(<Harness initial={makeDraft()} />);
    openField();
    addQuestion('Só uma');
    fireEvent.change(screen.getByLabelText('Instruções para a IA (opcional)'), {
      target: { value: 'Seja breve' },
    });
    expect(assistOf()).toEqual({ questions: ['Só uma'], instructions: 'Seja breve' });
    expect(screen.getByLabelText('Instruções para a IA (opcional)').getAttribute('maxlength')).toBe(
      '500',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remover pergunta da ajuda' }));
    expect('assist' in latest.fields[0]!).toBe(false);
  });

  it('clearing the text of a question removes it, and assist when none is left', () => {
    const warning = 'Nenhum campo tem perguntas: a ajuda não vai aparecer para o cliente.';
    render(<Harness initial={makeDraft({ assist: { enabled: true } })} />);
    openField();
    addQuestion('Primeira');
    addQuestion('Segunda');
    fireEvent.change(screen.getByLabelText('Pergunta 1'), { target: { value: '   ' } });
    expect(assistOf()).toEqual({ questions: ['Segunda'] });
    fireEvent.change(screen.getByLabelText('Pergunta 1'), { target: { value: '' } });
    expect('assist' in latest.fields[0]!).toBe(false);
    goTab('Geral');
    expect(screen.getByText(warning)).toBeTruthy();
  });

  it('toggle sets assist.enabled', () => {
    render(<Harness initial={makeDraft()} />);
    goTab('Geral');
    fireEvent.click(screen.getByRole('switch', { name: 'Ajuda da IA para o cliente' }));
    expect(latest.assist).toEqual({ enabled: true });
    fireEvent.click(screen.getByRole('switch', { name: 'Ajuda da IA para o cliente' }));
    expect(latest.assist).toEqual({ enabled: false });
  });

  it('warns when enabled without any field with questions', () => {
    const warning = 'Nenhum campo tem perguntas: a ajuda não vai aparecer para o cliente.';
    render(<Harness initial={makeDraft({ assist: { enabled: true } })} />);
    goTab('Geral');
    expect(screen.getByText(warning)).toBeTruthy();
    openField();
    addQuestion('Algo?');
    goTab('Geral');
    expect(screen.queryByText(warning)).toBeNull();
  });

  it('JSON tab round-trips assist', () => {
    const draft = makeDraft({ assist: { enabled: true } });
    (draft.fields[0] as { assist?: unknown }).assist = {
      questions: ['O que vende?'],
      instructions: 'Seja breve',
    };
    render(<Harness initial={draft} />);
    fireEvent.click(screen.getByRole('tab', { name: /JSON/ }));
    const area = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(JSON.parse(area.value).fields[0].assist).toEqual({
      questions: ['O que vende?'],
      instructions: 'Seja breve',
    });
    const edited = JSON.parse(area.value);
    edited.fields[0].assist.questions.push('Quem compra?');
    edited.assist = { enabled: false };
    fireEvent.change(area, { target: { value: JSON.stringify(edited) } });
    expect((assistOf() as { questions: string[] }).questions).toEqual([
      'O que vende?',
      'Quem compra?',
    ]);
    expect(latest.assist).toEqual({ enabled: false });
  });
});
