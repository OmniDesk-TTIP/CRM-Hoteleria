import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/auth.decorators';
import { RolesGuard } from '../auth/auth.guard';
import { UserRole } from '../../infrastructure/database/entities/User.entity';
import { SatisfactionSurveyService } from './satisfactionSurvey.service';
import {
  ListSurveysQueryDto,
  SurveyPeriodQueryDto,
} from './dto/listSurveys.dto';
import { UpdateSurveyPublicationDto } from './dto/updatePublication.dto';
import {
  PaginatedSurveyResponsesDto,
  SurveyResponseDto,
  SurveySummaryDto,
} from './dto/surveyResponse.dto';

/** Resultados de las encuestas de satisfacción (US-18). Solo para Administradores (CA6). */
@Controller('surveys')
@Roles(UserRole.ADMIN)
@UseGuards(RolesGuard)
export class SatisfactionSurveyController {
  constructor(private readonly surveyService: SatisfactionSurveyService) {}

  @Get()
  list(
    @Query() query: ListSurveysQueryDto,
  ): Promise<PaginatedSurveyResponsesDto> {
    return this.surveyService.list(query);
  }

  @Get('summary')
  summary(@Query() query: SurveyPeriodQueryDto): Promise<SurveySummaryDto> {
    return this.surveyService.getSummary(query);
  }

  @Patch(':id/publication')
  setPublication(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateSurveyPublicationDto,
  ): Promise<SurveyResponseDto> {
    return this.surveyService.setPublication(id, body.published, new Date());
  }
}
