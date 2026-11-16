import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module';
import { BookingProcessModule } from '../bookingProcess/bookingProcess.module';
import { EvalController } from './eval.controller';

/** Endpoint para correr evals del bot. AppModule solo lo carga si EVAL_API_KEY está definida. */
@Module({
  imports: [BotModule, BookingProcessModule],
  controllers: [EvalController],
})
export class EvalModule {}
