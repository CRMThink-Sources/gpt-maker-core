import { Controller, Get, Header, StreamableFile } from '@nestjs/common';
import { HELP_SKILL_NAME } from './help-skill-package';
import { HelpSkillService } from './help-skill.service';

/** Rotas anônimas: o cache limita o custo de consultas repetidas (design D6). */
const CACHE = 'public, max-age=300';

/**
 * Conteúdo e download da skill de ajuda. Rota pública: quem consulta é o Claude do cliente, sem
 * sessão, e só saem dados globais de funções abertas a todos (spec customer-help-skill).
 */
@Controller('public/help-skill')
export class HelpSkillController {
  constructor(private readonly help: HelpSkillService) {}

  @Get('content')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  @Header('Cache-Control', CACHE)
  @Header('X-Content-Type-Options', 'nosniff')
  content(): Promise<string> {
    return this.help.content();
  }

  @Get('download')
  @Header('Cache-Control', CACHE)
  async download(): Promise<StreamableFile> {
    return new StreamableFile(await this.help.package(), {
      type: 'application/zip',
      disposition: `attachment; filename="${HELP_SKILL_NAME}.zip"`,
    });
  }
}
