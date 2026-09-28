import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { APP_CODE } from '@gptmaker/platform-sdk';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { enrichContext } from '../../shared/context/request-context';
import { DomainError } from '../../shared/http/api-exception.filter';
import { PlatformSignatureGuard } from '../../shared/platform/platform-signature.guard';
import { InstallerService } from './installer.service';

// `InstallerPayload` do OpenAPI da plataforma.
const installerPayload = z.object({
  installationId: z.number().int().positive(),
  memberId: z.string().min(1),
  domain: z.string().min(1),
  appCode: z.string().min(1),
  isReinstall: z.boolean(),
});

class InstallerPayloadDto extends createZodDto(installerPayload) {}

@Controller('platform')
export class InstallerController {
  constructor(private readonly installer: InstallerService) {}

  @Post('installer')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PlatformSignatureGuard)
  async install(@Body() body: InstallerPayloadDto): Promise<{ tenantCode: string }> {
    if (body.appCode !== APP_CODE) {
      throw new DomainError(
        'APP_CODE_MISMATCH',
        'Instalador chamado para outro app',
        HttpStatus.BAD_REQUEST,
      );
    }
    const tenant = await this.installer.install(body);
    enrichContext({ tenantId: tenant.id });
    return { tenantCode: tenant.tenantCode };
  }
}
