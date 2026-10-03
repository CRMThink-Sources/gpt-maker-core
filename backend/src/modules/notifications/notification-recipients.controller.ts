import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import {
  type NotificationRecipientsView,
  notificationRecipientsSchema,
  type NotificationTestView,
} from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { NotificationService } from './notification.service';

class RecipientsDto extends createZodDto(notificationRecipientsSchema) {}

/** Tela de destinatários dos avisos: só o administrador do portal (spec credit-billing). */
@Controller('app/notification-recipients')
export class NotificationRecipientsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @AppAuth('admin')
  async list(@CurrentSession() session: AppSession): Promise<NotificationRecipientsView> {
    return { bitrixUserIds: await this.notifications.recipients(session.tenantId) };
  }

  @Put()
  @AppAuth('admin')
  async set(
    @CurrentSession() session: AppSession,
    @Body() body: RecipientsDto,
  ): Promise<NotificationRecipientsView> {
    return {
      bitrixUserIds: await this.notifications.setRecipients(
        session.tenantId,
        body.bitrixUserIds,
        session.userId,
      ),
    };
  }

  @Post('test')
  @AppAuth('admin')
  @HttpCode(HttpStatus.OK)
  test(@CurrentSession() session: AppSession): Promise<NotificationTestView> {
    return this.notifications.sendTest(session.tenantId, session.userId);
  }
}
