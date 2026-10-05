import { Module } from '@nestjs/common';
import { BitrixModule } from '../bitrix';
import { TenancyModule } from '../tenancy';
import { NotificationRecipientsController } from './notification-recipients.controller';
import { NotificationService } from './notification.service';

@Module({
  imports: [BitrixModule, TenancyModule],
  controllers: [NotificationRecipientsController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationsModule {}
