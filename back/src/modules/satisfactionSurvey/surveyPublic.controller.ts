import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../auth/auth.decorators';
import { SatisfactionSurveyService } from './satisfactionSurvey.service';
import { SubmitSurveyDto } from './dto/submitSurvey.dto';
import { PublicSurveyDto } from './dto/publicSurvey.dto';

// Fuera de la autenticación: lo consume la web pública del hotel con el link que Chamber le
// manda al huésped. El token del link es la credencial; sin él no se llega a ninguna encuesta.
@Public()
@Controller('public/surveys')
export class SurveyPublicController {
  constructor(private readonly surveyService: SatisfactionSurveyService) {}

  @Get(':token')
  get(@Param('token') token: string): Promise<PublicSurveyDto> {
    return this.surveyService.getForGuest(token, new Date());
  }

  @Post(':token')
  submit(
    @Param('token') token: string,
    @Body() body: SubmitSurveyDto,
  ): Promise<PublicSurveyDto> {
    return this.surveyService.submit(token, body, new Date());
  }
}
