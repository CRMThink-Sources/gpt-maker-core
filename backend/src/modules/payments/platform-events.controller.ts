import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { PlatformEvent } from '@crmthink-sources/platform-sdk';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { TenantService } from '../tenancy';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { enrichContext } from '../../shared/context/request-context';
import { DomainError } from '../../shared/http/api-exception.filter';
import { EXCHANGES } from '../../shared/messaging/topology';
import { PlatformSignatureGuard } from '../../shared/platform/platform-signature.guard';
import { PlatformEventStore } from './platform-event.store';

// Envelope comum dos webhooks do OpenAPI; `data` de cada tipo é validado por quem o consome.
const envelope = z.object({
  eventId: z.string().min(1),
  type: z.string().min(1),
  appCode: z.string().min(1),
  installationId: z.number().int().positive(),
  memberId: z.string(),
  occurredAt: z.string(),
  subscription: z
    .object({
      id: z.number().int(),
      status: z.enum(['trialing', 'active', 'past_due', 'cancelled', 'trial_expired']),
      modality: z.enum(['stripe', 'manual']),
      planId: z.number().int(),
      periodStart: z.string(),
      periodEnd: z.string(),
      version: z.number().int(),
    })
    .nullable(),
  data: z.record(z.string(), z.unknown()),
});

class PlatformEventDto extends createZodDto(envelope) {}

/**
 * Entrada dos eventos do crmthink-platform (instalação e cobrança): assinatura válida ⇒ grava em
 * `payment_event` (dedupe por `eventId`), publica em `payments.events` e responde 2xx; o efeito é
 * aplicado pelo worker. Falha ao publicar não perde o evento: a varredura republica.
 */
@Controller('platform')
export class PlatformEventsController {
  private readonly logger = new Logger(PlatformEventsController.name);

  constructor(
    private readonly store: PlatformEventStore,
    private readonly tenants: TenantService,
    private readonly amqp: AmqpConnection,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('events')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PlatformSignatureGuard)
  async receive(@Body() body: PlatformEventDto): Promise<{ received: true; duplicate: boolean }> {
    const event = body as PlatformEvent;
    if (event.appCode !== this.env.APP_CODE) {
      throw new DomainError('APP_CODE_MISMATCH', 'Evento de outro app', HttpStatus.BAD_REQUEST);
    }
    const tenant = await this.tenants.findByInstallationId(event.installationId);
    if (tenant) enrichContext({ tenantId: tenant.id });

    const inserted = await this.store.record(event, tenant?.id);
    if (!inserted) return { received: true, duplicate: true };

    try {
      await this.amqp.publish(
        EXCHANGES.paymentsEvents,
        event.type,
        { eventId: event.eventId },
        { persistent: true, messageId: event.eventId },
      );
    } catch (error) {
      this.logger.warn(
        { eventId: event.eventId, err: error },
        'publicação adiada para a varredura',
      );
    }
    return { received: true, duplicate: false };
  }
}
