import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Put } from '@nestjs/common';
import { type AiKeyView, aiKeyInputSchema } from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { AiKeyService } from './ai-key.service';

class AiKeyDto extends createZodDto(aiKeyInputSchema) {}

/**
 * Chave de IA do cliente. Salvar e remover são só do admin do portal (a chave `vibe_api_` pode
 * abrir dados dele); ver o estado serve a quem edita a função, para o botão "Revisar com IA".
 */
@Controller('app/ai-key')
export class AiKeyController {
  constructor(private readonly keys: AiKeyService) {}

  @Get()
  @AppAuth('manage')
  view(@CurrentSession() session: AppSession): Promise<AiKeyView> {
    return this.keys.view(session.tenantId);
  }

  @Put()
  @AppAuth('admin')
  save(@CurrentSession() session: AppSession, @Body() body: AiKeyDto): Promise<AiKeyView> {
    return this.keys.save(session.tenantId, body.apiKey);
  }

  @Delete()
  @AppAuth('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentSession() session: AppSession): Promise<void> {
    await this.keys.remove(session.tenantId);
  }
}
