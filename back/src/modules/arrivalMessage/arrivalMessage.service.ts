import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { ArrivalMessageType } from '../../infrastructure/database/entities/ArrivalMessage.entity';
import { addDays, zonedDateKey } from '../../common/date.util';
import { ChatService } from '../chat/chat.service';
import { describeSchedule } from '../restaurant/model/restaurant.model';
import { RestaurantService } from '../restaurant/restaurant.service';
import { TIME_REGEX } from '../spa/dto/createSpaService.dto';
import { SpaService } from '../spa/spa.service';
import { SupportHoursService } from '../supportHours/supportHours.service';
import { zonedNow } from '../supportHours/supportHours.util';
import {
  buildReminderMessage,
  buildWelcomeMessage,
  DEFAULT_ARRIVAL_INFO,
  DEFAULT_CHECK_IN_TIME,
  failureStatusOf,
  isReminderDue,
  isWelcomeDue,
  WelcomeInfo,
} from './arrivalMessage.model';
import {
  ArrivalMessageRepository,
  ArrivalRecipient,
} from './arrivalMessage.repository';

/** Mensajes de cada tipo por corrida del cron: los que sobren salen en la siguiente. */
const MESSAGES_PER_RUN = 50;

@Injectable()
export class ArrivalMessageService {
  private readonly logger = new Logger(ArrivalMessageService.name);
  private readonly checkInTime: string;
  private readonly arrivalInfo: string;

  constructor(
    private readonly arrivalMessageRepository: ArrivalMessageRepository,
    private readonly supportHoursService: SupportHoursService,
    private readonly spaService: SpaService,
    private readonly restaurantService: RestaurantService,
    private readonly chatService: ChatService,
    configService: ConfigService,
    @InjectBot() private readonly bot: Telegraf<Context>,
  ) {
    const checkInTime = configService.get<string>('HOTEL_CHECK_IN_TIME');
    if (checkInTime && !TIME_REGEX.test(checkInTime)) {
      this.logger.warn(
        `HOTEL_CHECK_IN_TIME="${checkInTime}" no tiene formato HH:mm. Se usa ${DEFAULT_CHECK_IN_TIME}.`,
      );
    }
    this.checkInTime =
      checkInTime && TIME_REGEX.test(checkInTime)
        ? checkInTime
        : DEFAULT_CHECK_IN_TIME;
    this.arrivalInfo =
      configService.get<string>('HOTEL_ARRIVAL_INFO') || DEFAULT_ARRIVAL_INFO;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleMessagesCron(): Promise<void> {
    try {
      await this.sendDueMessages(new Date());
    } catch (error) {
      this.logger.error(
        `Falló la corrida de mensajes de llegada: ${String(error)}`,
      );
    }
  }

  /** Manda los recordatorios y bienvenidas que correspondan a este momento. Devuelve cuántos salieron. */
  async sendDueMessages(now: Date): Promise<number> {
    const timeZone = this.supportHoursService.getTimeZone();
    const today = zonedDateKey(now, timeZone);
    const { minutes } = zonedNow(now, timeZone);

    let sent = 0;
    if (isReminderDue(minutes, this.checkInTime)) {
      sent += await this.sendReminders(addDays(today, 1), now);
    }
    if (isWelcomeDue(minutes)) sent += await this.sendWelcomes(today, now);

    if (sent > 0) {
      this.logger.log(`Enviados ${sent} mensaje(s) de llegada`);
    }
    return sent;
  }

  /** CA1: recordatorio con la fecha, el horario de ingreso y cómo llegar. */
  private async sendReminders(checkInDay: string, now: Date): Promise<number> {
    const type = ArrivalMessageType.REMINDER;
    const recipients = await this.arrivalMessageRepository.findRecipients(
      type,
      checkInDay,
      MESSAGES_PER_RUN,
    );

    return this.deliverAll(type, recipients, now, ({ guestFullName }) =>
      buildReminderMessage(
        guestFullName,
        checkInDay,
        this.checkInTime,
        this.arrivalInfo,
      ),
    );
  }

  /** CA2: bienvenida con la información para el ingreso y lo que se le puede ofrecer hoy. */
  private async sendWelcomes(today: string, now: Date): Promise<number> {
    const type = ArrivalMessageType.WELCOME;
    const recipients = await this.arrivalMessageRepository.findRecipients(
      type,
      today,
      MESSAGES_PER_RUN,
    );
    if (recipients.length === 0) return 0;

    const info = await this.loadWelcomeInfo(now);
    return this.deliverAll(type, recipients, now, ({ guestFullName }) =>
      buildWelcomeMessage(guestFullName, info),
    );
  }

  private async loadWelcomeInfo(now: Date): Promise<WelcomeInfo> {
    const { weekday } = zonedNow(now, this.supportHoursService.getTimeZone());
    const [reception, spaServices, { settings }] = await Promise.all([
      this.supportHoursService.getDaySchedule(now),
      this.spaService.listActive(),
      this.restaurantService.getSettings(),
    ]);

    return {
      checkInTime: this.checkInTime,
      reception,
      roomService: settings.roomServiceEnabled
        ? {
            opensAt: settings.roomServiceOpensAt,
            closesAt: settings.roomServiceClosesAt,
          }
        : null,
      spaServices: spaServices
        .filter((service) => service.availableWeekdays.includes(weekday))
        .map((service) => service.name),
      restaurantSchedule:
        settings.isActive() && settings.availableWeekdays.includes(weekday)
          ? describeSchedule(settings)
          : null,
    };
  }

  private async deliverAll(
    type: ArrivalMessageType,
    recipients: ArrivalRecipient[],
    now: Date,
    buildMessage: (recipient: ArrivalRecipient) => string,
  ): Promise<number> {
    let sent = 0;
    for (const recipient of recipients) {
      if (await this.deliver(type, recipient, buildMessage(recipient), now))
        sent += 1;
    }
    return sent;
  }

  /** CA4: lo que falle con un huésped queda registrado y no frena a los demás. */
  private async deliver(
    type: ArrivalMessageType,
    recipient: ArrivalRecipient,
    message: string,
    now: Date,
  ): Promise<boolean> {
    try {
      const id = await this.arrivalMessageRepository.claim(
        recipient.reservationId,
        type,
      );
      if (!id) return false;

      const sent = await this.send(id, recipient, message, now);
      if (sent) await this.recordInChat(recipient.telegramUserId, message);
      return sent;
    } catch (error) {
      this.logger.error(
        `No se pudo procesar el mensaje ${type} de la reserva ${recipient.reservationId}: ${String(error)}`,
      );
      return false;
    }
  }

  private async send(
    id: string,
    { reservationId, telegramUserId }: ArrivalRecipient,
    message: string,
    now: Date,
  ): Promise<boolean> {
    try {
      await this.bot.telegram.sendMessage(telegramUserId, message);
    } catch (error) {
      this.logger.warn(
        `No se pudo mandar el mensaje de llegada de la reserva ${reservationId} a ${telegramUserId}: ${String(error)}`,
      );
      await this.arrivalMessageRepository.markFailed(
        id,
        failureStatusOf(error),
        String(error),
      );
      return false;
    }

    await this.arrivalMessageRepository.markSent(id, now);
    return true;
  }

  /** Va al chat como mensaje de Chamber: así el panel lo ve y Chamber entiende si el huésped responde. */
  private async recordInChat(
    telegramUserId: string,
    message: string,
  ): Promise<void> {
    try {
      const session = await this.chatService.getOrCreateSession(telegramUserId);
      await this.chatService.recordBotMessage(session, message);
    } catch (error) {
      this.logger.warn(
        `No se pudo registrar el mensaje de llegada en el chat de ${telegramUserId}: ${String(error)}`,
      );
    }
  }
}
