import { Update, Ctx, Start, On, Message, Action } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { MikroORM, RequestContext } from '@mikro-orm/core';
import { Logger } from '@nestjs/common';
import {
  ReservationService,
  ALTERNATIVE_DATES_WINDOW_DAYS,
} from '../reservation/reservation.service';
import { BookingProcessService } from '../bookingProcess/bookingProcess.service';
import { ChatService } from '../chat/chat.service';
import {
  RoomServiceChatResult,
  RoomServiceService,
} from '../roomService/roomService.service';
import { BotService, TECHNICAL_ERROR_REPLY } from '../bot/bot.service';
import { ChatSession } from '../../infrastructure/database/entities/ChatSession.entity';
import { TelegramProfile } from '../chat/chat.repository';
import {
  escapeHtml,
  EXPIRED_DECLINE_LABEL,
  EXPIRED_RECOVERY_CALLBACK,
  EXPIRED_RESUME_LABEL,
  formatAlternativesFallback,
  ROOM_SERVICE_BUTTON_LABELS,
  ROOM_SERVICE_CALLBACK,
  RoomServiceButton,
} from './telegram.format';

/**
 * Adaptador de Telegram: recibe los mensajes y botones, le pasa el texto al BotService
 * y entrega su respuesta en el chat. La lógica de qué contestar vive en el BotService.
 */
@Update()
export class TelegramUpdate {
  private readonly logger = new Logger(TelegramUpdate.name);

  constructor(
    private readonly botService: BotService,
    private readonly reservationService: ReservationService,
    private readonly bookingProcessService: BookingProcessService,
    private readonly chatService: ChatService,
    private readonly roomServiceService: RoomServiceService,
    private readonly orm: MikroORM,
  ) {}

  @Start()
  async start(@Ctx() ctx: Context) {
    const greeting =
      '¡Hola! Soy Chamber , el asistente virtual del hotel. ¿En qué puedo ayudarte?';

    if (ctx.from) {
      await this.withRequestContext(async () => {
        const session = await this.chatService.getOrCreateSession(
          ctx.from!.id.toString(),
          this.readProfile(ctx),
        );
        await this.chatService.recordBotMessage(session, greeting);
      });
    }

    await ctx.reply(greeting);
  }

  @On('text')
  async onMessage(@Message('text') text: string, @Ctx() ctx: Context) {
    if (!ctx.from) return;

    await this.withRequestContext(() =>
      this.handleGuestMessage(text, ctx, ctx.from!.id.toString()),
    );
  }

  private async handleGuestMessage(
    text: string,
    ctx: Context,
    telegramUserId: string,
  ): Promise<void> {
    const result = await this.botService.handleGuestMessage({
      telegramUserId,
      text,
      profile: this.readProfile(ctx),
      onProcessingStart: () => ctx.sendChatAction('typing'),
    });

    try {
      switch (result.kind) {
        case 'muted':
        case 'discarded':
          return;
        case 'handover':
        case 'error':
          await ctx.reply(result.text);
          return;
        case 'reply':
          await ctx.reply(result.text, {
            parse_mode: 'HTML',
            ...result.keyboard,
          });
          if (result.document) await ctx.replyWithDocument(result.document);
      }
    } catch (error: unknown) {
      this.logger.error(
        `Error enviando la respuesta a ${telegramUserId}: ${String(error)}`,
      );
      await ctx.reply(TECHNICAL_ERROR_REPLY).catch(() => undefined);
    }
  }

  @Action(ROOM_SERVICE_CALLBACK)
  async onRoomServiceAction(@Ctx() ctx: Context) {
    await ctx.answerCbQuery().catch(() => undefined);
    const data =
      ctx.callbackQuery && 'data' in ctx.callbackQuery
        ? ctx.callbackQuery.data
        : '';
    const match = ROOM_SERVICE_CALLBACK.exec(data);
    if (!ctx.from || !match) return;

    await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);

    const [, button, orderId] = match;
    await this.withRequestContext(() =>
      this.handleRoomServiceAction(
        ctx,
        ctx.from!.id.toString(),
        button as RoomServiceButton,
        orderId,
      ),
    );
  }

  private async handleRoomServiceAction(
    ctx: Context,
    telegramUserId: string,
    button: RoomServiceButton,
    orderId: string,
  ): Promise<void> {
    let session: ChatSession | undefined;
    try {
      session = await this.chatService.getOrCreateSession(
        telegramUserId,
        this.readProfile(ctx),
      );
      await this.chatService.recordIncomingMessage(
        session,
        ROOM_SERVICE_BUTTON_LABELS[button],
      );
      await ctx.sendChatAction('typing');

      const botReply = await this.resolveRoomServiceButton(
        telegramUserId,
        button,
        orderId,
      );

      await this.chatService.recordBotMessage(session, botReply);
      await ctx.reply(botReply, { parse_mode: 'HTML' });
    } catch (error: unknown) {
      this.logger.error(
        `Error procesando el botón de room service ${button} del pedido ${orderId}: ${String(error)}`,
      );
      if (session) await this.botService.registerFailureSafely(session);
      await ctx.reply(
        'Hubo un error técnico con tu pedido de room service. Por favor, intentá nuevamente en unos minutos.',
      );
    }
  }

  private async resolveRoomServiceButton(
    telegramUserId: string,
    button: RoomServiceButton,
    orderId: string,
  ): Promise<string> {
    let result: RoomServiceChatResult;
    switch (button) {
      case 'confirm':
        result = await this.roomServiceService.confirmOrder(
          telegramUserId,
          orderId,
        );
        break;
      case 'discard':
        result = await this.roomServiceService.discardDraft(
          telegramUserId,
          orderId,
        );
        break;
      case 'cancel':
        result = await this.roomServiceService.cancelOrder(
          telegramUserId,
          orderId,
        );
        break;
      case 'keep':
        return 'Perfecto, tu pedido sigue en curso.';
    }
    return result.ok ? result.reply : escapeHtml(result.reason);
  }

  @Action(EXPIRED_RECOVERY_CALLBACK)
  async onExpiredRecovery(@Ctx() ctx: Context) {
    await ctx.answerCbQuery().catch(() => undefined);
    const data =
      ctx.callbackQuery && 'data' in ctx.callbackQuery
        ? ctx.callbackQuery.data
        : '';
    const match = EXPIRED_RECOVERY_CALLBACK.exec(data);
    if (!ctx.from || !match) return;

    await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);

    const [, answer, reservationId] = match;
    await this.withRequestContext(() =>
      this.handleExpiredRecovery(
        ctx,
        ctx.from!.id.toString(),
        reservationId,
        answer === 'resume',
      ),
    );
  }

  private async handleExpiredRecovery(
    ctx: Context,
    telegramUserId: string,
    reservationId: string,
    wantsToResume: boolean,
  ): Promise<void> {
    let session: ChatSession | undefined;
    try {
      session = await this.chatService.getOrCreateSession(
        telegramUserId,
        this.readProfile(ctx),
      );
      await this.chatService.recordIncomingMessage(
        session,
        wantsToResume ? EXPIRED_RESUME_LABEL : EXPIRED_DECLINE_LABEL,
      );
      await ctx.sendChatAction('typing');

      const botReply = wantsToResume
        ? await this.resolveResumeExpired(telegramUserId, reservationId)
        : await this.reservationService.declineExpiredRecovery(
            telegramUserId,
            reservationId,
          );

      await this.chatService.recordBotMessage(session, botReply);
      await ctx.reply(botReply, { parse_mode: 'HTML' });
    } catch (error: unknown) {
      this.logger.error(
        `Error retomando la reserva vencida ${reservationId}: ${String(error)}`,
      );
      if (session) await this.botService.registerFailureSafely(session);
      await ctx.reply(
        'Hubo un error técnico al retomar tu reserva. Escribime las fechas y para cuántas personas y la buscamos de nuevo.',
      );
    }
  }

  private async resolveResumeExpired(
    telegramUserId: string,
    reservationId: string,
  ): Promise<string> {
    const result = await this.reservationService.resumeExpiredReservation(
      telegramUserId,
      reservationId,
    );
    if (result.kind === 'reply') return result.reply;

    const activeBooking =
      await this.bookingProcessService.getActive(telegramUserId);
    const search = await this.reservationService.searchAvailability(
      telegramUserId,
      activeBooking,
      result.search,
    );
    const intro = 'La habitación que tenías ya no está libre para esas fechas.';
    if (search.available) return `${intro}\n\n${search.reply}`;
    if (search.alternatives.length === 0) {
      return `${intro} Tampoco nos quedan lugares en esas fechas ni en los ${ALTERNATIVE_DATES_WINDOW_DAYS} días cercanos. ¿Probamos con otras fechas?`;
    }
    return formatAlternativesFallback(
      search.alternatives,
      `${intro} Te paso estas opciones cercanas:`,
    );
  }

  private withRequestContext<T>(work: () => Promise<T>): Promise<T> {
    return RequestContext.create(this.orm.em, work);
  }

  private readProfile(ctx: Context): TelegramProfile | undefined {
    if (!ctx.from) return undefined;
    return {
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      username: ctx.from.username,
      languageCode: ctx.from.language_code,
    };
  }
}
