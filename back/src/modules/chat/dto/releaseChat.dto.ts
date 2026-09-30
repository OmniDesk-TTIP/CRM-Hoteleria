import { IsBoolean, IsOptional } from 'class-validator';

export class ReleaseChatDto {
  /**
   * Cierra el proceso de reserva que quedó a medias. Sirve cuando el operador terminó la venta
   * a mano desde el panel de reservas: sin esto, al volver el control el bot vuelve a ofrecer
   * la misma habitación (ver isOfferAlreadyPending en telegram.update.ts).
   */
  @IsOptional()
  @IsBoolean({ message: 'closeActiveBooking debe ser booleano' })
  closeActiveBooking?: boolean;
}
