import { Controller, Get, HttpStatus, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { TrainingImageService } from './training-image.service';

/**
 * Entrega a imagem de um treinamento de texto ao GPTMaker, que guarda a URL e a busca (`HEAD` e
 * `GET`). Rota pública: a "senha" é o token aleatório da imagem na URL (spec
 * agent-training-image). O Express atende `HEAD` com o mesmo handler, sem corpo.
 */
@Controller('public/training-images')
export class TrainingImageController {
  constructor(private readonly images: TrainingImageService) {}

  @Get(':token')
  async serve(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const image = await this.images.readPublic(token);
    if (!image) {
      res.status(HttpStatus.NOT_FOUND).type('text/plain').send('Imagem não encontrada');
      return;
    }
    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', image.mimetype);
    if (image.contentLength !== undefined) res.setHeader('Content-Length', image.contentLength);
    // `inline`: o GPTMaker e o navegador exibem a imagem, não baixam um anexo.
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    image.body.on('error', () => res.destroy());
    image.body.pipe(res);
  }
}
