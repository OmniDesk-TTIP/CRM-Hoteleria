import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { CampaignController } from './campaign.controller';
import { CampaignRepository } from './campaign.repository';
import { CampaignService } from './campaign.service';

@Module({
  imports: [ChatModule],
  controllers: [CampaignController],
  providers: [CampaignRepository, CampaignService],
})
export class CampaignModule {}
