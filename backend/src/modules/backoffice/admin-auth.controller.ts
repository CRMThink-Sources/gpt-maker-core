import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  adminLoginSchema,
  type AdminLoginStep,
  type AdminSessionView,
  adminTotpSchema,
  BACKOFFICE_HEADER,
  changePasswordSchema,
} from '@gptmaker/contracts';
import type { Request, Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { ADMIN_COOKIE, AdminAuth, CurrentOperator, sessionToken } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import type { Operator } from './operator.service';

class LoginDto extends createZodDto(adminLoginSchema) {}
class TotpDto extends createZodDto(adminTotpSchema) {}
class ChangePasswordDto extends createZodDto(changePasswordSchema) {}

const sessionView = (operator: Operator): AdminSessionView => ({
  operator: { id: operator.id, email: operator.email, name: operator.name, role: operator.role },
});

/** Login do backoffice: senha, código TOTP, sessão em cookie httpOnly (design D17). */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Req() req: Request, @Body() body: LoginDto): Promise<AdminLoginStep> {
    requireHeader(req);
    return this.auth.login(body.email, body.password);
  }

  @Post('totp')
  @HttpCode(HttpStatus.OK)
  async totp(
    @Req() req: Request,
    @Body() body: TotpDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminSessionView> {
    requireHeader(req);
    const { operator, token } = await this.auth.verify(body.challenge, body.code);
    res.cookie(ADMIN_COOKIE, token, {
      httpOnly: true,
      secure: this.env.BACKOFFICE_COOKIE_SECURE,
      sameSite: 'strict',
      path: '/admin',
      maxAge: this.env.BACKOFFICE_SESSION_MAX_HOURS * 3_600_000,
    });
    return sessionView(operator);
  }

  @Get('me')
  @AdminAuth()
  me(@CurrentOperator() operator: Operator): AdminSessionView {
    return sessionView(operator);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    requireHeader(req);
    await this.auth.logout(sessionToken(req));
    res.clearCookie(ADMIN_COOKIE, { path: '/admin' });
  }

  @Post('password')
  @AdminAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentOperator() operator: Operator,
    @Body() body: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.changePassword(operator, body.current, body.next);
    // Todas as sessões caem, inclusive esta: o operador entra de novo com a senha nova.
    res.clearCookie(ADMIN_COOKIE, { path: '/admin' });
  }
}

/** Login e logout não têm sessão para o guard: o CSRF é conferido aqui. */
function requireHeader(req: Request): void {
  if (req.header(BACKOFFICE_HEADER) !== '1') {
    throw new ForbiddenException('Requisição sem o cabeçalho do backoffice');
  }
}
