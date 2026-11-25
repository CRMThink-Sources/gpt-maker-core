import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { FunctionCatalog } from '../agent-functions';
import { renderHelpContent } from './help-content';
import { buildHelpSkillZip } from './help-skill-package';

/** Textos escritos à mão, copiados para o `dist/` pelos `assets` do `nest-cli.json`. */
function readContent(file: string): string {
  return readFileSync(join(__dirname, 'content', file), 'utf8').replace(/\r\n/g, '\n');
}

/** Conteúdo e pacote da skill de ajuda do cliente (spec customer-help-skill). */
@Injectable()
export class HelpSkillService {
  private readonly guide = readContent('guia.md');
  private readonly skillTemplate = readContent('SKILL.md');

  constructor(
    private readonly catalog: FunctionCatalog,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async content(): Promise<string> {
    return renderHelpContent({
      guide: this.guide,
      functions: await this.catalog.listPublicForms(),
      generatedAt: new Date(),
    });
  }

  async package(): Promise<Uint8Array> {
    return buildHelpSkillZip({
      skillTemplate: this.skillTemplate,
      content: await this.content(),
      contentUrl: `${this.env.API_PUBLIC_URL}/public/help-skill/content`,
      supportUrl: this.env.PUBLIC_SUPPORT_URL,
    });
  }
}
