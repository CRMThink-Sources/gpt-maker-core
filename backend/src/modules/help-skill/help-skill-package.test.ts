import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildHelpSkillZip } from './help-skill-package';

const skillTemplate = readFileSync(join(__dirname, 'content', 'SKILL.md'), 'utf8');

function build(supportUrl?: string): Record<string, string> {
  const zip = buildHelpSkillZip({
    skillTemplate,
    content: '# Ajuda do GPTThink\n\nConteúdo gerado em 25/11/2026.\n',
    contentUrl: 'https://api.staging.exemplo.com/public/help-skill/content',
    supportUrl,
  });
  return Object.fromEntries(
    Object.entries(unzipSync(zip)).map(([name, bytes]) => [name, strFromU8(bytes)]),
  );
}

describe('pacote da skill de ajuda (spec customer-help-skill)', () => {
  it('tem a pasta da skill com o SKILL.md e a cópia do conteúdo', () => {
    const files = build();
    expect(Object.keys(files).sort()).toEqual([
      'gptthink-ajuda/SKILL.md',
      'gptthink-ajuda/referencia/conteudo.md',
    ]);
    expect(files['gptthink-ajuda/referencia/conteudo.md']).toContain('gerado em 25/11/2026');
  });

  it('o SKILL.md tem nome, descrição e a URL do ambiente que gerou o pacote', () => {
    const skill = build()['gptthink-ajuda/SKILL.md']!;
    expect(skill).toMatch(/^---\nname: gptthink-ajuda\ndescription: .+\n---\n/);
    expect(skill).toContain('https://api.staging.exemplo.com/public/help-skill/content');
    expect(skill).toContain('referencia/conteudo.md');
    expect(skill).not.toContain('{{');
  });

  it('com suporte configurado, o SKILL.md traz o link', () => {
    const skill = build('https://suporte.exemplo.com/chat')['gptthink-ajuda/SKILL.md']!;
    expect(skill).toContain('https://suporte.exemplo.com/chat');
  });

  it('sem suporte configurado, orienta a procurar o suporte pelo app', () => {
    const skill = build()['gptthink-ajuda/SKILL.md']!;
    expect(skill).toContain('procurar o suporte pelo próprio aplicativo');
  });

  it('não cita o fornecedor da plataforma nem o backoffice', () => {
    const skill = build()['gptthink-ajuda/SKILL.md']!;
    expect(skill).not.toMatch(/gpt ?maker|backoffice/i);
  });
});
