import { Body, Controller, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { DomainError } from '../../shared/http/api-exception.filter';
import { TrainingService } from './training.service';

/**
 * Chamado pelo GPTMaker quando um treinamento termina (`callbackUrl` informado na criação).
 * Rota pública: a autenticação é o token aleatório por treinamento na query (`?t=`).
 */
@Controller('gptmaker/trainings')
export class TrainingCallbackController {
  constructor(private readonly trainings: TrainingService) {}

  @Post('callback')
  @HttpCode(HttpStatus.OK)
  async callback(@Query('t') token: string | undefined, @Body() body: unknown) {
    if (!token) {
      throw new DomainError(
        'TRAINING_CALLBACK_INVALID',
        'Token do callback ausente',
        HttpStatus.UNAUTHORIZED,
      );
    }
    await this.trainings.applyCallback(token, body);
    return { received: true };
  }
}
