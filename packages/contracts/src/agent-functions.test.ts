import { describe, expect, it } from 'vitest';
import {
  collapseBlocks,
  expandBlocks,
  type FunctionTemplateContent,
  functionBlockContentSchema,
  functionTemplateContentSchema,
  functionTemplateDraftSchema,
  functionTemplateErrors,
  availableMarkers,
  templateIssues,
} from './agent-functions';
import { sdrFixture, sdrFixtureInput } from './agent-functions.fixture';

const withBehavior = (behavior: string): FunctionTemplateContent => ({ ...sdrFixture, behavior });

describe('schema do template de função', () => {
  it('aceita um template válido', () => {
    expect(functionTemplateContentSchema.safeParse(sdrFixtureInput).success).toBe(true);
    expect(functionTemplateErrors(sdrFixture)).toEqual([]);
  });

  it('recusa marcador sem campo no comportamento', () => {
    expect(functionTemplateErrors(withBehavior('Olá {{sdr.inexistente}}'))).toContain(
      'marcador sem campo em comportamento: {{sdr.inexistente}}',
    );
  });

  it('deixa marcadores de execução para as intenções', () => {
    expect(functionTemplateErrors(withBehavior('{{contact.name}} {{empresa.nome}}'))).not.toEqual(
      expect.arrayContaining([expect.stringContaining('contact.name')]),
    );
  });

  it('recusa opção sem trecho', () => {
    const result = functionTemplateContentSchema.safeParse({
      ...sdrFixtureInput,
      fields: [
        {
          kind: 'CHOICE',
          id: 'comum.tom',
          label: 'Tom',
          required: true,
          options: [{ value: 'formal', label: 'Formal', snippet: '  ' }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('recusa dependente que nenhum texto cita', () => {
    const content: FunctionTemplateContent = {
      ...sdrFixture,
      fields: sdrFixture.fields.map((field) =>
        field.id === 'sdr.cliente_atual' && field.kind === 'CHOICE'
          ? {
              ...field,
              options: field.options.map((option) => ({ ...option, snippet: 'Transfira.' })),
            }
          : field,
      ),
    };
    expect(functionTemplateErrors(content)).toContain(
      'campo dependente sem uso: sdr.canal_suporte',
    );
  });

  it('recusa condição com opção inexistente e campo repetido', () => {
    const [intention] = sdrFixture.intentions;
    const content: FunctionTemplateContent = {
      ...sdrFixture,
      fields: [...sdrFixture.fields, sdrFixture.fields[0]!],
      intentions: [{ ...intention!, when: { field: 'registro.onde', in: ['email'] } }],
    };
    expect(functionTemplateErrors(content)).toEqual(
      expect.arrayContaining([
        'campo repetido: empresa.nome',
        'condição da intenção qualificacao cita opção inexistente: registro.onde=email',
      ]),
    );
  });

  it('recusa id de campo com raiz de execução', () => {
    const result = functionTemplateContentSchema.safeParse({
      ...sdrFixtureInput,
      fields: [{ kind: 'TEXT', id: 'contact.nome', label: 'x', required: true, maxLength: 10 }],
    });
    expect(result.success).toBe(false);
  });
});

describe('expansão de blocos', () => {
  const block = functionBlockContentSchema.parse({
    fields: [{ kind: 'TEXT', id: 'comum.cidade', label: 'Cidade', required: false, maxLength: 50 }],
    behavior: 'Se não souber, registre a dúvida.',
  });

  it('inclui campos e troca o trecho do bloco', () => {
    const draft = functionTemplateDraftSchema.parse({
      ...sdrFixtureInput,
      blocks: ['duvida'],
      behavior: `${sdrFixtureInput.behavior}\n{{bloco.duvida}}`,
    });
    const { content, errors } = expandBlocks(draft, new Map([['duvida', block]]));
    expect(errors).toEqual([]);
    expect(content.fields[0]?.id).toBe('comum.cidade');
    expect(content.behavior).toContain('Se não souber, registre a dúvida.');
    expect('blocks' in content).toBe(false);
  });

  it('acusa bloco não incluído', () => {
    const draft = functionTemplateDraftSchema.parse({
      ...sdrFixtureInput,
      behavior: '{{bloco.duvida}}',
    });
    expect(expandBlocks(draft, new Map([['duvida', block]])).errors).toEqual([
      'bloco não incluído no template: duvida',
    ]);
  });
});

describe('rascunho a partir de uma versão', () => {
  const block = functionBlockContentSchema.parse({
    fields: [{ kind: 'TEXT', id: 'comum.cidade', label: 'Cidade', required: false, maxLength: 50 }],
    behavior: 'Se não souber, registre a dúvida.',
  });
  const blocks = new Map([['duvida', block]]);
  const draft = functionTemplateDraftSchema.parse({
    ...sdrFixtureInput,
    blocks: ['duvida'],
    behavior: `${sdrFixtureInput.behavior}\n{{bloco.duvida}}`,
  });
  const { content } = expandBlocks(draft, blocks);

  it('volta a referenciar o bloco e reproduz a versão', () => {
    const collapsed = collapseBlocks(content, draft, blocks);
    expect(collapsed?.behavior).toBe(draft.behavior);
    expect(collapsed?.fields.map((field) => field.id)).toEqual(
      draft.fields.map((field) => field.id),
    );
    expect(expandBlocks(collapsed!, blocks).content).toEqual(content);
  });

  it('recusa quando o texto do bloco mudou depois da versão', () => {
    const changed = new Map([['duvida', { ...block, behavior: 'Registre a dúvida e avise.' }]]);
    expect(collapseBlocks(content, draft, changed)).toBeNull();
  });

  it('campo que saiu do bloco depois da versão volta como campo próprio', () => {
    const changed = new Map([['duvida', { ...block, fields: [] }]]);
    const collapsed = collapseBlocks(content, draft, changed);
    expect(collapsed?.fields[0]?.id).toBe('comum.cidade');
    expect(expandBlocks(collapsed!, changed).content).toEqual(content);
  });

  it('recusa bloco inexistente', () => {
    expect(collapseBlocks(content, { ...draft, blocks: ['duvida', 'nada'] }, blocks)).toBeNull();
  });
});

describe('problemas com endereço', () => {
  it('aponta o comportamento, a opção, o dependente e a ação', () => {
    const [intention] = sdrFixture.intentions;
    const content: FunctionTemplateContent = {
      ...sdrFixture,
      behavior: `${sdrFixture.behavior}\n{{sdr.nada}}`,
      fields: sdrFixture.fields.map((field) =>
        field.id === 'sdr.cliente_atual' && field.kind === 'CHOICE'
          ? {
              ...field,
              options: field.options.map((option) => ({
                ...option,
                snippet: 'Transfira. {{x.y}}',
              })),
            }
          : field,
      ),
      intentions: [
        {
          ...intention!,
          actions: [
            intention!.actions[0]!,
            { ...intention!.actions[1]!, when: { field: 'registro.onde', in: ['email'] } },
          ],
        },
      ],
    };
    const issues = templateIssues(content);
    expect(issues).toEqual(
      expect.arrayContaining([
        {
          where: { section: 'behavior' },
          message: 'marcador sem campo em comportamento: {{sdr.nada}}',
        },
        {
          where: { section: 'form', fieldId: 'sdr.cliente_atual', option: 'transferir' },
          message: 'marcador sem campo em opção sdr.cliente_atual=transferir: {{x.y}}',
        },
        {
          where: { section: 'form', fieldId: 'sdr.canal_suporte' },
          message: 'campo dependente sem uso: sdr.canal_suporte',
        },
        {
          where: { section: 'actions', intentionKey: 'qualificacao', actionIndex: 1 },
          message: 'condição da intenção qualificacao cita opção inexistente: registro.onde=email',
        },
      ]),
    );
    // As mensagens de texto continuam as mesmas.
    expect(functionTemplateErrors(content)).toEqual(issues.map((issue) => issue.message));
  });
});

describe('marcadores por contexto', () => {
  const names = (list: Array<{ marker: string }>) => list.map((item) => item.marker);

  it('no texto do agente: campos, funil, sistema e blocos; sem itens da base', () => {
    const list = names(availableMarkers(sdrFixture, { kind: 'behavior' }, { blocks: ['duvida'] }));
    expect(list).toEqual(
      expect.arrayContaining([
        'empresa.nome',
        'sdr.canal_suporte',
        'registro.funil.categoryId',
        'registro.funil.stageId',
        'agente.nome',
        'avancado.instrucoes_adicionais',
        'bloco.duvida',
      ]),
    );
    expect(list).not.toContain('base.produtos');
    expect(list).not.toContain('contact.name');
  });

  it('na intenção: execução, coletados e respostas; sem blocos', () => {
    const list = names(
      availableMarkers(
        sdrFixture,
        { kind: 'intention', key: 'qualificacao' },
        { blocks: ['duvida'] },
      ),
    );
    expect(list).toEqual(
      expect.arrayContaining(['intencao.respostas', 'contact.name', 'empresa.nome']),
    );
    expect(list).not.toContain('bloco.duvida');
  });
});

describe('vários usuários, canal aberto, agente e transferências (D15–D17)', () => {
  const transfer = {
    key: 'vendas',
    agent: '{{sdr.agente_vendas}}',
    instructions: 'Quando o cliente pedir orçamento.',
  };

  it('BITRIX_USER aceita multiple e assume false', () => {
    const parsed = functionTemplateContentSchema.parse({
      ...sdrFixtureInput,
      fields: [
        ...sdrFixtureInput.fields,
        { kind: 'BITRIX_USER', id: 'sdr.atendentes', label: 'Atendentes', required: true },
        {
          kind: 'BITRIX_USER',
          id: 'sdr.vendedores',
          label: 'Vendedores',
          required: true,
          multiple: true,
        },
      ],
    });
    const byId = new Map(parsed.fields.map((field) => [field.id, field]));
    expect(byId.get('sdr.atendentes')).toMatchObject({ multiple: false });
    expect(byId.get('sdr.vendedores')).toMatchObject({ multiple: true });
  });

  it('aceita os campos de canal aberto e de agente', () => {
    const parsed = functionTemplateContentSchema.safeParse({
      ...sdrFixtureInput,
      fields: [
        ...sdrFixtureInput.fields,
        { kind: 'BITRIX_OPENLINE', id: 'sdr.canal', label: 'Canal', required: true },
        { kind: 'AGENT', id: 'sdr.agente_vendas', label: 'Agente de vendas', required: true },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('transfers: padrão vazio e no máximo 5', () => {
    expect(functionTemplateContentSchema.parse(sdrFixtureInput).transfers).toEqual([]);
    const many = Array.from({ length: 6 }, (_, index) => ({ ...transfer, key: `t${index}` }));
    expect(
      functionTemplateContentSchema.safeParse({ ...sdrFixtureInput, transfers: many }).success,
    ).toBe(false);
    expect(
      functionTemplateContentSchema.parse({ ...sdrFixtureInput, transfers: [transfer] })
        .transfers[0],
    ).toMatchObject({ key: 'vendas', returnOnFinish: false });
  });

  it('expandBlocks junta as transferências do rascunho e dos blocos', () => {
    const block = functionBlockContentSchema.parse({
      transfers: [{ ...transfer, key: 'do_bloco' }],
    });
    const draft = functionTemplateDraftSchema.parse({
      ...sdrFixtureInput,
      blocks: ['comum_x'],
      transfers: [transfer],
    });
    const { content } = expandBlocks(draft, new Map([['comum_x', block]]));
    expect(content.transfers.map((item) => item.key)).toEqual(['vendas', 'do_bloco']);
  });

  it('marcadores de campo múltiplo, canal e agente só nas intenções', () => {
    const content = functionTemplateContentSchema.parse({
      ...sdrFixtureInput,
      fields: [
        ...sdrFixtureInput.fields,
        { kind: 'BITRIX_USER', id: 'sdr.vendedores', label: 'V', required: true, multiple: true },
        { kind: 'BITRIX_OPENLINE', id: 'sdr.canal', label: 'Canal', required: true },
        { kind: 'AGENT', id: 'sdr.agente_vendas', label: 'Agente', required: true },
      ],
    });
    const behavior = names(availableMarkers(content, { kind: 'behavior' }));
    for (const id of ['sdr.vendedores', 'sdr.canal', 'sdr.agente_vendas'])
      expect(behavior).not.toContain(id);
    const intention = names(availableMarkers(content, { kind: 'intention', key: 'qualificacao' }));
    expect(intention).toEqual(expect.arrayContaining(['sdr.vendedores', 'sdr.canal']));
  });
});

const names = (list: Array<{ marker: string }>) => list.map((item) => item.marker);
