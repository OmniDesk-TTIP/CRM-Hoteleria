import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { v4 } from 'uuid';
import {
  ArrivalMessage,
  ArrivalMessageStatus,
  ArrivalMessageType,
} from '../../infrastructure/database/entities/ArrivalMessage.entity';
import { ReservationStatus } from '../../infrastructure/database/entities/Reservation.entity';

/** Reserva que todavía no recibió un mensaje automático. */
export interface ArrivalRecipient {
  reservationId: string;
  telegramUserId: string;
  guestFullName: string;
}

@Injectable()
export class ArrivalMessageRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Reservas confirmadas que entran ese día (YYYY-MM-DD), con chat de Telegram y sin ese mensaje.
   * Las cargadas a mano sin Telegram quedan afuera: no hay a quién escribirle.
   */
  async findRecipients(
    type: ArrivalMessageType,
    checkInDay: string,
    limit: number,
  ): Promise<ArrivalRecipient[]> {
    const rows = await this.em.getConnection().execute<
      {
        id: string;
        telegram_user_id: string;
        guest_full_name: string;
      }[]
    >(
      `
      SELECT r.id, r.telegram_user_id, r.guest_full_name
      FROM reservations r
      WHERE r.status = ?
        AND r.telegram_user_id IS NOT NULL
        AND r.check_in = ?::date
        AND NOT EXISTS (
          SELECT 1 FROM arrival_messages m
          WHERE m.reservation_id = r.id AND m.type = ?
        )
      ORDER BY r.id
      LIMIT ?
      `,
      [ReservationStatus.CONFIRMED, checkInDay, type, limit],
    );

    return rows.map((row) => ({
      reservationId: row.id,
      telegramUserId: row.telegram_user_id,
      guestFullName: row.guest_full_name,
    }));
  }

  /**
   * Reserva el mensaje antes de mandarlo y devuelve su id. Es un solo INSERT que vuelve a mirar la
   * reserva: si se canceló después de listarla (CA3) o si otro proceso ya tomó el mensaje (CA1),
   * no inserta nada y devuelve null.
   */
  async claim(
    reservationId: string,
    type: ArrivalMessageType,
  ): Promise<string | null> {
    const id = v4();
    const { affectedRows } = await this.em.getConnection().execute<{
      affectedRows: number;
    }>(
      `
      INSERT INTO arrival_messages (id, reservation_id, type, telegram_user_id, status)
      SELECT ?, r.id, ?, r.telegram_user_id, ?
      FROM reservations r
      WHERE r.id = ? AND r.status = ?
      ON CONFLICT (reservation_id, type) DO NOTHING
      `,
      [
        id,
        type,
        ArrivalMessageStatus.PENDING,
        reservationId,
        ReservationStatus.CONFIRMED,
      ],
      'run',
    );
    return affectedRows === 1 ? id : null;
  }

  async markSent(id: string, sentAt: Date): Promise<void> {
    await this.em.nativeUpdate(
      ArrivalMessage,
      { id, status: ArrivalMessageStatus.PENDING },
      { status: ArrivalMessageStatus.SENT, sentAt },
    );
  }

  async markFailed(
    id: string,
    status: ArrivalMessageStatus,
    failureReason: string,
  ): Promise<void> {
    await this.em.nativeUpdate(
      ArrivalMessage,
      { id, status: ArrivalMessageStatus.PENDING },
      { status, failureReason },
    );
  }
}
