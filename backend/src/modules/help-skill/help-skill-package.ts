import { strToU8, zipSync } from 'fflate';

/** Pasta que o cliente instala no Claude; o nome é o mesmo `name` do `SKILL.md`. */
export const HELP_SKILL_NAME = 'gptthink-ajuda';

export interface HelpSkillPackageInput {
  skillTemplate: string;
  /** Cópia reserva, usada quando o Claude não alcança a URL (design D1). */
  content: string;
  contentUrl: string;
  supportUrl?: string;
}

export function buildHelpSkillZip(input: HelpSkillPackageInput): Uint8Array {
  const values: Record<string, string> = {
    CONTENT_URL: input.contentUrl,
    CONTENT_DOMAIN: new URL(input.contentUrl).hostname,
    SUPPORT: input.supportUrl ?? 'peça para procurar o suporte pelo próprio aplicativo',
  };
  // `\r\n` de um checkout no Windows quebraria o cabeçalho da skill.
  const skill = input.skillTemplate
    .replace(/\r\n/g, '\n')
    .replace(/\{\{([A-Z_]+)\}\}/g, (marker, key: string) => values[key] ?? marker);
  // Caminhos completos: sem entradas de diretório no arquivo.
  return zipSync({
    [`${HELP_SKILL_NAME}/SKILL.md`]: strToU8(skill),
    [`${HELP_SKILL_NAME}/referencia/conteudo.md`]: strToU8(input.content),
  });
}
