import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  type CreateReviewResult,
  createReviewInputSchema,
  reviewCrossInputSchema,
  type ReviewCrossResult,
  reviewFieldInputSchema,
  reviewGapsInputSchema,
  type ReviewGapsResult,
  type ReviewFieldResult,
} from '@gptmaker/contracts';
import { createZodDto } from 'nestjs-zod';
import { AppAuth, type AppSession, CurrentSession } from '../tenancy';
import { FunctionReviewService } from './function-review.service';

class CreateReviewDto extends createZodDto(createReviewInputSchema) {}
class ReviewFieldDto extends createZodDto(reviewFieldInputSchema) {}
class ReviewCrossDto extends createZodDto(reviewCrossInputSchema) {}
class ReviewGapsDto extends createZodDto(reviewGapsInputSchema) {}

/** Revisão por IA da função: acesso `manage`, como a edição da função (design D6). */
@Controller('app/agents/:id/function/review')
export class FunctionReviewController {
  constructor(private readonly reviews: FunctionReviewService) {}

  @Post()
  @AppAuth('manage')
  create(
    @CurrentSession() session: AppSession,
    @Param('id') id: string,
    @Body() body: CreateReviewDto,
  ): Promise<CreateReviewResult> {
    return this.reviews.create(session.tenantId, id, body);
  }

  @Post(':reviewId/field')
  @AppAuth('manage')
  @HttpCode(HttpStatus.OK)
  field(
    @CurrentSession() session: AppSession,
    @Param('id') id: string,
    @Param('reviewId') reviewId: string,
    @Body() body: ReviewFieldDto,
  ): Promise<ReviewFieldResult> {
    return this.reviews.reviewField(session.tenantId, id, reviewId, body);
  }

  @Post(':reviewId/cross')
  @AppAuth('manage')
  @HttpCode(HttpStatus.OK)
  cross(
    @CurrentSession() session: AppSession,
    @Param('id') id: string,
    @Param('reviewId') reviewId: string,
    @Body() body: ReviewCrossDto,
  ): Promise<ReviewCrossResult> {
    return this.reviews.cross(session.tenantId, id, reviewId, body);
  }

  @Post(':reviewId/gaps')
  @AppAuth('manage')
  @HttpCode(HttpStatus.OK)
  gaps(
    @CurrentSession() session: AppSession,
    @Param('id') id: string,
    @Param('reviewId') reviewId: string,
    @Body() body: ReviewGapsDto,
  ): Promise<ReviewGapsResult> {
    return this.reviews.gaps(session.tenantId, id, reviewId, body);
  }
}
