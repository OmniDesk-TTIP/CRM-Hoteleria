import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from '@mikro-orm/core';
import { addDays, zonedDateKey } from '../../common/date.util';
import { PaymentMethod } from '../../infrastructure/database/entities/Account.entity';
import {
  Reservation,
  ReservationOrigin,
  ReservationStatus,
} from '../../infrastructure/database/entities/Reservation.entity';
import {
  Room,
  RoomStatus,
} from '../../infrastructure/database/entities/Room.entity';
import {
  User,
  UserRole,
} from '../../infrastructure/database/entities/User.entity';
import { AccountService } from '../account/account.service';

const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';

/** Mediodía UTC: el mismo día calendario en UTC y en la zona del hotel. */
const toDateColumn = (isoDay: string): Date => new Date(`${isoDay}T12:00:00Z`);

/**
 * Datos de prueba para las evals (US-27): le da al huésped simulado una estadía en curso y, si se
 * pide, la cuenta corriente abierta. Escribe en la base como el resto de las evals: solo local.
 */
@Injectable()
export class EvalFixturesService {
  constructor(
    private readonly em: EntityManager,
    private readonly accountService: AccountService,
    private readonly config: ConfigService,
  ) {}

  /** Devuelve el id de la reserva creada: va de ayer a pasado mañana, confirmada. */
  async seedStay(
    telegramUserId: string,
    withAccount: boolean,
    now: Date = new Date(),
  ): Promise<string> {
    const em = this.em.fork();
    const room = await em.findOne(
      Room,
      { status: RoomStatus.ACTIVE },
      { orderBy: { roomNumber: 'asc' } },
    );
    if (!room) {
      throw new Error(
        'No hay habitaciones activas: cargá los datos del hotel antes de correr las evals',
      );
    }

    const today = zonedDateKey(
      now,
      this.config.get<string>('SUPPORT_TIMEZONE') ?? DEFAULT_TIMEZONE,
    );
    const reservation = em.create(Reservation, {
      room,
      telegramUserId,
      checkIn: toDateColumn(addDays(today, -1)),
      checkOut: toDateColumn(addDays(today, 2)),
      status: ReservationStatus.CONFIRMED,
      origin: ReservationOrigin.MANUAL,
      totalAmount: 100000,
      depositAmount: 30000,
      guestFullName: 'Eval Bot',
      guestDni: '00000000',
    });
    await em.persist(reservation).flush();

    if (withAccount) {
      const user =
        (await em.findOne(User, { role: UserRole.ADMIN, isActive: true })) ??
        (await em.findOne(User, { isActive: true }));
      if (!user) {
        throw new Error(
          'No hay usuarios en la base: hace falta uno para abrir la cuenta de la eval',
        );
      }
      await this.accountService.open(
        reservation.id,
        PaymentMethod.CASH,
        user.id,
        now,
      );
    }
    return reservation.id;
  }
}
