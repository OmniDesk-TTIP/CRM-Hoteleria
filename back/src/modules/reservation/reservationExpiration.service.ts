import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { Reservation } from '../../infrastructure/database/entities/Reservation.entity';
import { ChatService } from '../chat/chat.service';
import { expiredRecoveryKeyboard } from '../telegram/telegram.format';
import { ReservationRepository } from './reservation.repository';
import { ReservationService } from './reservation.service';
import {
  addMinutes,
  PAYMENT_REMINDER_MINUTES_BEFORE,
} from './reservation.model';

@Injectable()
export class ReservationExpirationService {
  private readonly logger = new Logger(ReservationExpirationService.name);

  constructor(
    private readonly reservationRepository: ReservationRepository,
    private readonly reservationService: ReservationService,
    private readonly chatService: ChatService,
    @InjectBot() private readonly bot: Telegraf<Context>,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpirationCron(): Promise<void> {
    const now = new Date();
    try {
      await this.expireOverdue(now);
      await this.sendReminders(now);
    } catch (error) {
      this.logger.error(
        `Falló la corrida de vencimiento de reservas: ${String(error)}`,
      );
    }
  }

  async expireOverdue(now: Date): Promise<number> {
    const overdue = await this.reservationRepository.findDueForExpiration(now);

    // Intentamos expirar todas en paralelo de forma limpia
    const expirationResults = await Promise.all(
      overdue.map(async (reservation) => {
        const isExpired = await this.reservationRepository.expireIfPending(
          reservation.id,
        );
        return { reservation, isExpired };
      }),
    );

    // Filtramos solo las que efectivamente pasaron a estado expirado
    const successfullyExpired = expirationResults.filter(
      ({ isExpired }) => isExpired,
    );

    // Enviamos las notificaciones en paralelo para las que tienen Telegram
    await Promise.all(
      successfullyExpired
        .filter(({ reservation }) => Boolean(reservation.telegramUserId))
        .map(({ reservation }) =>
          this.notify(
            reservation,
            this.reservationService.buildExpirationNotice(reservation),
            'el aviso de vencimiento',
            expiredRecoveryKeyboard(reservation.id),
          ),
        ),
    );

    const expiredCount = successfullyExpired.length;

    if (expiredCount > 0) {
      this.logger.log(`Vencidas ${expiredCount} reserva(s) por falta de pago`);
    }

    return expiredCount;
  }

  async sendReminders(now: Date): Promise<number> {
    const due = await this.reservationRepository.findDueForReminder(
      now,
      addMinutes(now, PAYMENT_REMINDER_MINUTES_BEFORE),
    );

    let sent = 0;
    for (const reservation of due) {
      if (
        !(await this.reservationRepository.markReminderSent(
          reservation.id,
          now,
        ))
      )
        continue;
      const delivered = await this.notify(
        reservation,
        this.reservationService.buildPaymentReminder(reservation, now),
        'el recordatorio de pago',
      );
      if (delivered) sent += 1;
    }
    return sent;
  }

  private async notify(
    reservation: Reservation,
    message: string,
    description: string,
    keyboard?: ReturnType<typeof expiredRecoveryKeyboard>,
  ): Promise<boolean> {
    const telegramUserId = reservation.telegramUserId!;
    try {
      await this.bot.telegram.sendMessage(telegramUserId, message, {
        parse_mode: 'HTML',
        ...keyboard,
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo mandar ${description} de la reserva ${reservation.id} a ${telegramUserId}: ${String(error)}`,
      );
      return false;
    }

    try {
      const session = await this.chatService.getOrCreateSession(telegramUserId);
      await this.chatService.recordBotMessage(session, message);
    } catch (error) {
      this.logger.warn(
        `No se pudo registrar ${description} en el chat de ${telegramUserId}: ${String(error)}`,
      );
    }
    return true;
  }
}
