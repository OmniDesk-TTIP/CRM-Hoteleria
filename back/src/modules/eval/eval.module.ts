import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { BotModule } from '../bot/bot.module';
import { BookingProcessModule } from '../bookingProcess/bookingProcess.module';
import { EvalController } from './eval.controller';
import { EvalFixturesService } from './evalFixtures.service';

/** Endpoint para correr evals del bot. AppModule solo lo carga si EVAL_API_KEY está definida. */
@Module({
  imports: [BotModule, BookingProcessModule, AccountModule],
  controllers: [EvalController],
  providers: [EvalFixturesService],
})
export class EvalModule {}
