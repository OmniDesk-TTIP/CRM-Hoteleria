import { Module } from '@nestjs/common';
import { SupportHoursModule } from '../supportHours/supportHours.module';
import { PromotionController } from './promotion.controller';
import { PromotionRepository } from './promotion.repository';
import { PromotionService } from './promotion.service';

@Module({
  imports: [SupportHoursModule],
  controllers: [PromotionController],
  providers: [PromotionRepository, PromotionService],
  exports: [PromotionService],
})
export class PromotionModule {}
