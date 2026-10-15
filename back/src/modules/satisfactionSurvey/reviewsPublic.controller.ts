import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../auth/auth.decorators';
import { SatisfactionSurveyService } from './satisfactionSurvey.service';
import {
  ListPublicReviewsQueryDto,
  PaginatedPublicReviewsDto,
  PublicReviewsSummaryDto,
} from './dto/publicReview.dto';

// Fuera de la autenticación: la sección de reseñas de la web pública del hotel. Solo muestra
// las reseñas que el administrador publicó con el consentimiento del huésped.
@Public()
@Controller('public/reviews')
export class ReviewsPublicController {
  constructor(private readonly surveyService: SatisfactionSurveyService) {}

  @Get()
  list(
    @Query() query: ListPublicReviewsQueryDto,
  ): Promise<PaginatedPublicReviewsDto> {
    return this.surveyService.listPublicReviews(query);
  }

  @Get('summary')
  summary(): Promise<PublicReviewsSummaryDto> {
    return this.surveyService.getPublicReviewsSummary();
  }
}
