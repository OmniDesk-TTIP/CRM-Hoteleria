import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { Reservation, ReservationStatus } from '../../infrastructure/database/entities/Reservation.entity';

@Injectable()
export class PaymentRepository {
  constructor(private readonly em: EntityManager) {}

  async findReservationById(id: string): Promise<Reservation | null> {
    return this.em.findOne(Reservation, { id }, { populate: ['room', 'room.category'] });
  }

  /**
   * Confirma la reserva solo si sigue pendiente de pago. El UPDATE condicional es atómico,
   * así que si el back_url y el webhook llegan casi a la vez, uno solo recibe true
   * y el aviso de Telegram se manda una única vez.
   */
  async confirmIfPending(reservationId: string, mpPaymentId: string): Promise<boolean> {
    const affected = await this.em.nativeUpdate(
      Reservation,
      { id: reservationId, status: ReservationStatus.PENDING_PAYMENT },
      { status: ReservationStatus.CONFIRMED, mpPaymentId },
    );

    return affected === 1;
  }

  async findExpiredPendingReservations(cutoffDate: Date): Promise<Reservation[]> {
    return this.em.find(Reservation, {
      status: ReservationStatus.PENDING_PAYMENT,
      createdAt: { $lt: cutoffDate },
    });
  }

  async cancelExpiredReservations(reservations: Reservation[]): Promise<void> {
    for (const reservation of reservations) {
      reservation.status = ReservationStatus.CANCELLED;
    }
    await this.em.flush();
  }
}
