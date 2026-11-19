import { describe, expect, it } from 'vitest';
import {
  collapseBlocks,
  expandBlocks,
  type FunctionBlockContent,
  type FunctionTemplateContent,
  type FunctionTemplateDraft,
  functionBlockContentSchema,
  functionTemplateContentSchema,
  functionTemplateDraftSchema,
  templateIssues,
} from './agent-functions';
import {
  localizeFunctionText,
  localizeTemplateContent,
  translatableTexts,
  translationCompleteness,
  translationIssues,
  translationOf,
  withTranslation,
} from './agent-function-translations';
import { sdrFixture } from './agent-functions.fixture';

const withTranslations = (translations: FunctionTemplateContent['translations']) => ({
  ...sdrFixture,
  translations,
});

const find = (content: FunctionTemplateContent, id: string) =>
  content.fields.find((field) => field.id === id)!;

describe('localizeTemplateContent', () => {
  const content = withTranslations({
    en: {
      fields: {
        'empresa.nome': { label: 'Company name', help: 'As customers know it' },
        'empresa.descricao': { label: 'What the company does', placeholder: 'We sell…' },
        'comum.tom': { label: 'Tone', options: { formal: 'Formal', normal: 'Friendly' } },
      },
    },
    es: { fields: { 'empresa.nome': { label: 'Nombre de la empresa' } } },
  });

  it('traduz rótulos, ajudas, placeholders e opções no idioma pedido', () => {
    const en = localizeTemplateContent(content, 'en');
    expect(find(en, 'empresa.nome')).toMatchObject({
      label: 'Company name',
      help: 'As customers know it',
    });
    expect(find(en, 'empresa.descricao')).toMatchObject({ placeholder: 'We sell…' });
    const tone = find(en, 'comum.tom');
    expect(tone.kind === 'CHOICE' && tone.options.map((option) => option.label)).toEqual([
      'Formal',
      'Friendly',
    ]);
  });

  it('texto sem tradução volta ao português e o resto fica no idioma', () => {
    const es = localizeTemplateContent(content, 'es');
    expect(find(es, 'empresa.nome').label).toBe('Nombre de la empresa');
    expect(find(es, 'empresa.descricao').label).toBe('O que a empresa faz');
  });

  it.each(['pt-BR', 'fr', '', null, undefined])('idioma %j usa o texto-base', (locale) => {
    const result = localizeTemplateContent(content, locale);
    expect(find(result, 'empresa.nome').label).toBe('Nome da empresa');
  });

  it('nunca devolve `translations` e não altera ids, valores nem o conteúdo do agente', () => {
    const en = localizeTemplateContent(content, 'en');
    expect('translations' in en).toBe(false);
    expect(en.behavior).toBe(sdrFixture.behavior);
    expect(en.intentions).toEqual(sdrFixture.intentions);
    expect(en.fields.map((field) => field.id)).toEqual(sdrFixture.fields.map((f) => f.id));
    const tone = find(en, 'comum.tom');
    expect(tone.kind === 'CHOICE' && tone.options.map((option) => option.snippet)).toEqual(
      sdrFixture.fields
        .filter((field) => field.id === 'comum.tom')
        .flatMap((field) => (field.kind === 'CHOICE' ? field.options.map((o) => o.snippet) : [])),
    );
  });

  it('não muta o conteúdo recebido', () => {
    const before = JSON.stringify(content);
    localizeTemplateContent(content, 'en');
    expect(JSON.stringify(content)).toBe(before);
  });

  it('traduz opções dependentes, subcampos, valores de SPA e perguntas do assistente', () => {
    const rich = functionTemplateContentSchema.parse({
      ...sdrFixture,
      fields: [
        {
          kind: 'CHOICE',
          id: 'a.escolha',
          label: 'Escolha',
          required: true,
          options: [
            {
              value: 'x',
              label: 'X',
              snippet: 'x',
              dependents: [
                { kind: 'TEXT', id: 'a.extra', label: 'Extra', required: false, maxLength: 50 },
              ],
            },
          ],
        },
        {
          kind: 'KNOWLEDGE',
          id: 'a.base',
          label: 'Base',
          required: false,
          maxItems: 3,
          format: '{{pergunta}}',
          subfields: [{ id: 'pergunta', label: 'Pergunta', required: true, maxLength: 100 }],
          assist: { questions: ['Qual?', 'Quando?'] },
        },
        {
          kind: 'BITRIX_SPA',
          id: 'a.spa',
          label: 'Processo',
          required: false,
          values: [{ id: 'nome', label: 'Nome', help: 'Ajuda', required: true }],
        },
      ],
      behavior: 'ok',
      intentions: [],
      translations: {
        en: {
          fields: {
            'a.escolha': { label: 'Choice', options: { x: 'Ex' } },
            'a.extra': { label: 'Extra field' },
            'a.base': {
              label: 'Base',
              subfields: { pergunta: 'Question' },
              assistQuestions: ['Which?'],
            },
            'a.spa': { spaValues: { nome: { label: 'Name', help: 'Help' } } },
          },
        },
      },
    });
    const en = localizeTemplateContent(rich, 'en');
    const choice = find(en, 'a.escolha');
    expect(choice.kind === 'CHOICE' && choice.options[0]!.label).toBe('Ex');
    expect(choice.kind === 'CHOICE' && choice.options[0]!.dependents?.[0]!.label).toBe(
      'Extra field',
    );
    const base = find(en, 'a.base');
    expect(base.kind === 'KNOWLEDGE' && base.subfields[0]!.label).toBe('Question');
    // pergunta sem tradução na mesma posição volta ao português
    expect(base.kind === 'KNOWLEDGE' && base.assist?.questions).toEqual(['Which?', 'Quando?']);
    const spa = find(en, 'a.spa');
    expect(spa.kind === 'BITRIX_SPA' && spa.values[0]).toMatchObject({
      label: 'Name',
      help: 'Help',
    });
  });
});

describe('localizeFunctionText', () => {
  const text = { name: 'Vendas', description: 'Qualifica leads' };
  const translations = { en: { name: 'Sales' } };

  it('usa a tradução e cai no português por texto', () => {
    expect(localizeFunctionText(text, translations, 'en')).toEqual({
      name: 'Sales',
      description: 'Qualifica leads',
    });
  });

  it.each(['es', 'pt-BR', 'xx', undefined])('idioma %j sem tradução usa o português', (locale) => {
    expect(localizeFunctionText(text, translations, locale)).toEqual(text);
  });
});

describe('validação das traduções', () => {
  it('recusa campo, opção, subcampo e valor de SPA inexistentes', () => {
    const content = withTranslations({
      en: {
        fields: {
          'nao.existe': { label: 'X' },
          'comum.tom': { options: { inexistente: 'Y' }, subfields: { z: 'Z' } },
        },
      },
    });
    expect(translationIssues(content)).toEqual([
      'tradução en: campo inexistente: nao.existe',
      'tradução en: opção inexistente em comum.tom: inexistente',
      'tradução en: subcampo inexistente em comum.tom: z',
    ]);
    expect(templateIssues(content).map((issue) => issue.message)).toEqual(
      expect.arrayContaining(['tradução en: campo inexistente: nao.existe']),
    );
  });

  it('tradução válida não gera problema', () => {
    const content = withTranslations({ en: { fields: { 'empresa.nome': { label: 'Company' } } } });
    expect(templateIssues(content)).toEqual([]);
  });

  it('o schema recusa tradução acima do limite do campo e chave desconhecida', () => {
    const tooLong = 'x'.repeat(121);
    expect(
      functionTemplateContentSchema.safeParse(
        withTranslations({ en: { fields: { 'empresa.nome': { label: tooLong } } } }),
      ).success,
    ).toBe(false);
    expect(
      functionTemplateContentSchema.safeParse({
        ...sdrFixture,
        translations: { fr: { name: 'Ventes' } },
      }).success,
    ).toBe(false);
  });

  it('conteúdo sem traduções continua válido', () => {
    expect(functionTemplateContentSchema.safeParse(sdrFixture).success).toBe(true);
  });
});

describe('completude das traduções', () => {
  it('conta o que falta em cada idioma e lista os caminhos', () => {
    const content = withTranslations({
      en: { fields: { 'empresa.nome': { label: 'Company' } } },
    });
    const [en, es] = translationCompleteness(content, { name: 'SDR', description: 'Vendas' });
    expect(en!.locale).toBe('en');
    expect(en!.translated).toBe(1);
    expect(en!.total).toBe(es!.total);
    expect(en!.missing).toContain('name');
    expect(en!.missing).not.toContain('fields.empresa.nome.label');
    expect(es!.translated).toBe(0);
    expect(es!.missing).toHaveLength(es!.total);
  });
});

describe('blocos e traduções', () => {
  const block: FunctionBlockContent = functionBlockContentSchema.parse({
    fields: [{ kind: 'TEXT', id: 'comum.site', label: 'Site', required: false, maxLength: 100 }],
    behavior: 'Site: {{comum.site}}',
    translations: { en: { fields: { 'comum.site': { label: 'Website' } } } },
  });
  const blocks = new Map([['comum', block]]);
  const draft: FunctionTemplateDraft = {
    agentType: 'SALE',
    settings: {},
    profile: { jobName: '', jobDescription: '', jobSite: '' },
    blocks: ['comum'],
    fields: [
      {
        kind: 'TEXT',
        id: 'sdr.meta',
        label: 'Meta',
        required: true,
        maxLength: 50,
        multiline: false,
      },
    ],
    behavior: '{{bloco.comum}} Meta: {{sdr.meta}}',
    intentions: [],
    transfers: [],
    crmAccess: false,
    assist: { enabled: false },
    translations: { en: { fields: { 'sdr.meta': { label: 'Goal' } } } },
  };

  it('expande juntando as traduções do bloco e as do template', () => {
    const { content, errors } = expandBlocks(draft, blocks);
    expect(errors).toEqual([]);
    expect(content.translations?.en?.fields).toEqual({
      'comum.site': { label: 'Website' },
      'sdr.meta': { label: 'Goal' },
    });
    const en = localizeTemplateContent(content, 'en');
    expect(en.fields.map((field) => field.label)).toEqual(['Website', 'Goal']);
  });

  it('em conflito, a tradução do template vence a do bloco', () => {
    const over: FunctionTemplateDraft = {
      ...draft,
      translations: { en: { fields: { 'comum.site': { label: 'Site URL' } } } },
    };
    const { content } = expandBlocks(over, blocks);
    expect(content.translations?.en?.fields?.['comum.site']?.label).toBe('Site URL');
  });

  it('ida e volta: colapsar a versão devolve o rascunho com as traduções do template', () => {
    const { content } = expandBlocks(draft, blocks);
    const collapsed = collapseBlocks(content, draft, blocks);
    expect(collapsed).not.toBeNull();
    expect(collapsed!.translations).toEqual({ en: { fields: { 'sdr.meta': { label: 'Goal' } } } });
  });

  it('sem traduções em lugar nenhum, o rascunho não ganha `translations`', () => {
    const plain: FunctionTemplateDraft = { ...draft, translations: undefined };
    const noTranslations = new Map([['comum', { ...block, translations: undefined }]]);
    const { content } = expandBlocks(plain, noTranslations);
    expect('translations' in content).toBe(false);
    const collapsed = collapseBlocks(content, plain, noTranslations);
    expect(collapsed).not.toBeNull();
    expect('translations' in collapsed!).toBe(false);
  });
});

describe('edição de uma tradução', () => {
  const texts = translatableTexts(sdrFixture, { name: 'SDR' });
  const byPath = (path: string) => texts.find((item) => item.path === path)!;

  it('lista os textos do formulário com o caminho de cada tradução', () => {
    expect(byPath('name').keys).toEqual(['name']);
    expect(byPath('fields.empresa.nome.label').keys).toEqual(['fields', 'empresa.nome', 'label']);
    expect(byPath('fields.comum.tom.options.formal').keys).toEqual([
      'fields',
      'comum.tom',
      'options',
      'formal',
    ]);
  });

  it('grava e lê a tradução sem mexer no que já existe', () => {
    const first = withTranslation(undefined, byPath('name'), 'Sales');
    const second = withTranslation(first, byPath('fields.empresa.nome.label'), 'Company');
    expect(second).toEqual({ name: 'Sales', fields: { 'empresa.nome': { label: 'Company' } } });
    expect(translationOf(second, byPath('name'))).toBe('Sales');
    expect(translationOf(second, byPath('fields.empresa.descricao.label'))).toBeUndefined();
    // o objeto de entrada não é alterado
    expect(first).toEqual({ name: 'Sales' });
  });

  it('valor vazio remove a tradução e os contêineres que ficarem vazios', () => {
    const filled = withTranslation(undefined, byPath('fields.empresa.nome.label'), 'Company');
    expect(withTranslation(filled, byPath('fields.empresa.nome.label'), '  ')).toBeUndefined();
  });

  it('perguntas do assistente: posição vazia no meio guarda texto vazio e o fim é aparado', () => {
    const assistField = {
      ...sdrFixture,
      fields: [
        {
          kind: 'TEXT' as const,
          id: 'a.texto',
          label: 'Texto',
          required: false,
          maxLength: 50,
          multiline: false,
          assist: { questions: ['Q1?', 'Q2?', 'Q3?'] },
        },
      ],
    };
    const items = translatableTexts(assistField);
    const q = (n: number) =>
      items.find((item) => item.path === `fields.a.texto.assistQuestions.${n}`)!;
    const third = withTranslation(undefined, q(2), 'Third?');
    expect(third).toEqual({ fields: { 'a.texto': { assistQuestions: ['', '', 'Third?'] } } });
    const cleared = withTranslation(third, q(2), '');
    expect(cleared).toBeUndefined();
  });
});

describe('perguntas do assistente com lacuna', () => {
  const content = functionTemplateContentSchema.parse({
    ...sdrFixture,
    fields: [
      {
        kind: 'TEXT',
        id: 'a.texto',
        label: 'Texto',
        required: false,
        maxLength: 50,
        assist: { questions: ['Q1?', 'Q2?'] },
      },
    ],
    behavior: 'ok',
    intentions: [],
    // só a 2ª pergunta traduzida: a 1ª fica vazia e o schema aceita
    translations: { en: { fields: { 'a.texto': { assistQuestions: ['', 'Second?'] } } } },
  });

  it('o schema aceita a lacuna e a pergunta sem tradução volta ao português', () => {
    const en = localizeTemplateContent(content, 'en');
    const field = en.fields[0]!;
    expect(field.kind === 'TEXT' && field.assist?.questions).toEqual(['Q1?', 'Second?']);
  });

  it('a pergunta vazia conta como não traduzida', () => {
    const [en] = translationCompleteness(content);
    expect(en!.missing).toContain('fields.a.texto.assistQuestions.0');
    expect(en!.missing).not.toContain('fields.a.texto.assistQuestions.1');
  });
});

describe('tradução de bloco', () => {
  it('só os campos do bloco valem: nome e descrição dele não passam para a função', () => {
    const block = functionBlockContentSchema.parse({
      fields: [{ kind: 'TEXT', id: 'comum.site', label: 'Site', required: false, maxLength: 100 }],
      behavior: 'x',
      translations: {
        en: {
          name: 'Do bloco',
          description: 'Do bloco',
          fields: { 'comum.site': { label: 'Web' } },
        },
      },
    });
    const draft = functionTemplateDraftSchema.parse({
      agentType: 'SALE',
      profile: { jobName: '', jobDescription: '', jobSite: '' },
      blocks: ['comum'],
      fields: [{ kind: 'TEXT', id: 'sdr.meta', label: 'Meta', required: true, maxLength: 50 }],
      behavior: '{{bloco.comum}} {{sdr.meta}}',
      intentions: [],
    });
    const { content } = expandBlocks(draft, new Map([['comum', block]]));
    expect(content.translations?.en?.name).toBeUndefined();
    expect(content.translations?.en?.description).toBeUndefined();
    expect(content.translations?.en?.fields?.['comum.site']?.label).toBe('Web');
  });

  it('o bloco com tradução de campo inexistente tem problema apontado', () => {
    const block = functionBlockContentSchema.parse({
      fields: [{ kind: 'TEXT', id: 'comum.site', label: 'Site', required: false, maxLength: 100 }],
      translations: { es: { fields: { 'nao.existe': { label: 'X' } } } },
    });
    expect(translationIssues(block)).toEqual(['tradução es: campo inexistente: nao.existe']);
  });
});
