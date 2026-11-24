import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module';
import { AccountController } from './account.controller';
import { AccountRepository } from './account.repository';
import { AccountService } from './account.service';

@Module({
  imports: [PaymentModule],
  controllers: [AccountController],
  providers: [AccountRepository, AccountService],
  exports: [AccountService],
})
export class AccountModule {}
