import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { SupportHoursModule } from '../supportHours/supportHours.module';
import { SatisfactionSurveyController } from './satisfactionSurvey.controller';
import { SatisfactionSurveyRepository } from './satisfactionSurvey.repository';
import { SatisfactionSurveyService } from './satisfactionSurvey.service';
import { SurveyPublicController } from './surveyPublic.controller';
import { ReviewsPublicController } from './reviewsPublic.controller';

@Module({
  imports: [ChatModule, SupportHoursModule],
  controllers: [
    SatisfactionSurveyController,
    SurveyPublicController,
    ReviewsPublicController,
  ],
  providers: [SatisfactionSurveyRepository, SatisfactionSurveyService],
})
export class SatisfactionSurveyModule {}
