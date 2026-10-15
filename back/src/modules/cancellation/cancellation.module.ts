import { Module } from '@nestjs/common';
import { SupportHoursModule } from '../supportHours/supportHours.module';
import { CancellationController } from './cancellation.controller';
import { CancellationRepository } from './cancellation.repository';
import { CancellationService } from './cancellation.service';

// No importa ReservationModule a propósito: lo importan al revés (reservas y Telegram usan este service), así que el repository trabaja directo sobre la entidad Reservation y no hay ciclo.
@Module({
  imports: [SupportHoursModule],
  controllers: [CancellationController],
  providers: [CancellationRepository, CancellationService],
  exports: [CancellationService],
})
export class CancellationModule {}
