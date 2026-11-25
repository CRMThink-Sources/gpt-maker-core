import type { FunctionField, FunctionTemplateContent } from '@gptmaker/contracts';

/** Função publicada como entra no conteúdo de ajuda. */
export interface HelpFunction {
  name: string;
  description: string;
  content: FunctionTemplateContent;
}

export interface HelpContentInput {
  guide: string;
  functions: HelpFunction[];
  generatedAt: Date;
}

/** Documento Markdown público: o guia escrito e o formulário de cada função. */
export function renderHelpContent({ guide, functions, generatedAt }: HelpContentInput): string {
  const date = generatedAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const sections = functions.length
    ? functions.map(renderFunction)
    : ['Nenhuma função disponível no momento.'];
  return `${[
    '# Ajuda do GPTThink',
    `Conteúdo gerado em ${date}.`,
    guide.trim(),
    '## Funções do agente e seus formulários',
    ...sections,
  ].join('\n\n')}\n`;
}

function renderFunction({ name, description, content }: HelpFunction): string {
  return [
    `### ${oneLine(name)}`,
    oneLine(description),
    content.fields.flatMap((field) => renderField(field, '')).join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Lista de permitidos (design D3): só entra o que o cliente lê no formulário. Um campo novo no
 * template fica de fora até ser citado aqui — trechos, intenções e ajuda da IA são internos.
 */
function renderField(field: FunctionField, indent: string): string[] {
  const required = field.required ? 'obrigatório' : 'opcional';
  const details = [`${describe(field)}.`];
  if (field.help) details.push(`Ajuda: ${oneLine(field.help)}`);
  if ((field.kind === 'TEXT' || field.kind === 'TEXT_LIST') && field.placeholder) {
    details.push(`Exemplo: ${oneLine(field.placeholder)}`);
  }
  const lines = [`${indent}- **${oneLine(field.label)}** (${required}): ${details.join(' ')}`];
  const inner = `${indent}  `;
  if (field.kind === 'CHOICE' || field.kind === 'MULTI_CHOICE') {
    for (const option of field.options) {
      lines.push(`${inner}- Opção: ${oneLine(option.label)}`);
      for (const dependent of option.dependents ?? []) {
        lines.push(...renderField(dependent, `${inner}  `));
      }
    }
  }
  if (field.kind === 'KNOWLEDGE') {
    for (const sub of field.subfields) {
      const subRequired = sub.required ? 'obrigatório' : 'opcional';
      lines.push(
        `${inner}- Em cada item: ${oneLine(sub.label)} (${subRequired}, até ${sub.maxLength} caracteres)`,
      );
    }
  }
  if (field.kind === 'BITRIX_SPA') {
    for (const value of field.values) {
      const parts = [
        `${inner}- Valor: ${oneLine(value.label)} (${value.required ? 'obrigatório' : 'opcional'}).`,
      ];
      if (value.options) parts.push(`Valores possíveis: ${value.options.join(', ')}.`);
      if (value.help) parts.push(`Ajuda: ${oneLine(value.help)}`);
      lines.push(parts.join(' '));
    }
  }
  return lines;
}

function describe(field: FunctionField): string {
  switch (field.kind) {
    case 'TEXT':
      return `texto de até ${field.maxLength} caracteres`;
    case 'TEXT_LIST':
      return `lista com no mínimo ${field.minItems} e no máximo ${field.maxItems} textos, cada um com até ${field.itemMaxLength} caracteres`;
    case 'URL':
      return 'link';
    case 'INTEGER':
      return `número de ${field.min} a ${field.max}`;
    case 'BITRIX_USER':
      return field.multiple ? 'um ou mais usuários do Bitrix24' : 'um usuário do Bitrix24';
    case 'BITRIX_STAGE':
      return 'etapa de um funil do Bitrix24';
    case 'BITRIX_OPENLINE':
      return 'canal aberto do Bitrix24';
    case 'AGENT':
      return 'outro agente seu';
    case 'BITRIX_SPA':
      return 'processo inteligente do Bitrix24; você escolhe o processo, o funil, a etapa e o campo de cada valor';
    case 'CHOICE':
      return 'escolha uma opção';
    case 'MULTI_CHOICE':
      return 'escolha uma ou mais opções';
    case 'KNOWLEDGE':
      return `base de conhecimento com até ${field.maxItems} itens`;
  }
}

/** Quebras de linha do texto cadastrado desmontariam a lista. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
