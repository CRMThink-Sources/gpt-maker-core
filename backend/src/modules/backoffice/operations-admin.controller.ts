import {
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import type { AdminDeadLetterPeek, AdminOperationsView } from '@gptmaker/contracts';
import { AdminAuth, CurrentOperator } from './admin-auth.guard';
import type { Operator } from './operator.service';
import { isQueueKey, OperationsAdminService } from './operations-admin.service';

/** DLQs do canal e portais com mais falhas: consulta para todos; descartar a fila só ADMIN. */
@Controller('admin/operations')
export class OperationsAdminController {
  constructor(private readonly operations: OperationsAdminService) {}

  @Get()
  @AdminAuth()
  overview(): Promise<AdminOperationsView> {
    return this.operations.overview();
  }

  @Get('dlq/:queue')
  @AdminAuth()
  peek(
    @Param('queue') queue: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<AdminDeadLetterPeek> {
    if (!isQueueKey(queue)) throw new NotFoundException('Fila desconhecida');
    return this.operations.peek(queue, Math.min(Math.max(limit, 1), 50));
  }

  @Post('dlq/:queue/purge')
  @AdminAuth('ADMIN')
  @HttpCode(HttpStatus.OK)
  purge(
    @CurrentOperator() actor: Operator,
    @Param('queue') queue: string,
  ): Promise<{ purged: number }> {
    if (!isQueueKey(queue)) throw new NotFoundException('Fila desconhecida');
    return this.operations.purge(queue, actor.id);
  }
}
