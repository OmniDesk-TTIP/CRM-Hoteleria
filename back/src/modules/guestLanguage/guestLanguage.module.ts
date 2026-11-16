import { Module } from '@nestjs/common';
import { GuestLanguageService } from './guestLanguage.service';

@Module({
  providers: [GuestLanguageService],
  exports: [GuestLanguageService],
})
export class GuestLanguageModule {}
