import { IsIn } from 'class-validator';
import { SpaReservationStatus } from '../../../infrastructure/database/entities/SpaReservation.entity';

export class UpdateSpaReservationStatusDto {
  // Una solicitud solo se resuelve: volver a PENDING no es una acción válida.
  @IsIn([SpaReservationStatus.CONFIRMED, SpaReservationStatus.REJECTED], {
    message: 'El estado debe ser CONFIRMED o REJECTED',
  })
  status!: SpaReservationStatus.CONFIRMED | SpaReservationStatus.REJECTED;
}
