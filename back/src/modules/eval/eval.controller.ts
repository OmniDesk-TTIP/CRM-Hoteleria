import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from '@mikro-orm/core';
import { Public } from '../auth/auth.decorators';
import { AccountService } from '../account/account.service';
import { BotService, BotTurnResult } from '../bot/bot.service';
import { BookingProcessService } from '../bookingProcess/bookingProcess.service';
import {
  ROOM_SERVICE_CALLBACK,
  RoomServiceButton,
} from '../telegram/telegram.format';
import { ChatSession } from '../../infrastructure/database/entities/ChatSession.entity';
import { EvalConversationDto } from './dto/evalConversation.dto';
import { EvalFixturesService } from './evalFixtures.service';

export interface EvalTurn {
  message: string;
  kind: BotTurnResult['kind'];
  /** Lo que vería el huésped. Vacío si el bot no contestó (chat silenciado). */
  reply: string;
  /**
   * Acción que eligió Gemini (REPLY, SEARCH_AVAILABILITY, ...), o BUTTON si el mensaje fue tocar
   * un botón. Null en handover/error/muted.
   */
  action: string | null;
  buttons: string[];
  document: string | null;
  error: string | null;
  latencyMs: number;
}

/** Mensaje que simula tocar un botón: `[botón] Cargar a la habitación`. */
const BUTTON_MESSAGE = /^\[bot[oó]n\]\s*(.+)$/i;

interface PressableButton {
  text: string;
  callbackData: string | null;
}

/**
 * Endpoint para evaluar el bot (offline evals con promptfoo). Recibe mensajes como si los
 * mandara un huésped por Telegram y devuelve qué contestó el bot en cada turno, más el estado
 * en que quedó todo, para poder chequearlo sin depender del texto.
 *
 * Solo existe si EVAL_API_KEY está configurada (ver EvalModule) y exige esa clave en el header
 * x-eval-key. Cada request llama a Gemini y escribe en la base: nunca habilitarlo en producción.
 */
@Controller('eval')
export class EvalController {
  constructor(
    private readonly botService: BotService,
    private readonly bookingProcessService: BookingProcessService,
    private readonly config: ConfigService,
    private readonly em: EntityManager,
    private readonly fixtures: EvalFixturesService,
    private readonly accountService: AccountService,
  ) {}

  @Public()
  @Post('conversation')
  @HttpCode(HttpStatus.OK)
  async conversation(
    @Headers('x-eval-key') evalKey: string | undefined,
    @Body() dto: EvalConversationDto,
  ) {
    this.assertValidKey(evalKey);

    const telegramUserId = dto.userId ?? `eval-${randomUUID()}`;
    const reservationId =
      dto.stay || dto.account
        ? await this.fixtures.seedStay(telegramUserId, !!dto.account)
        : null;

    const turns: EvalTurn[] = [];
    let lastButtons: PressableButton[] = [];

    for (const message of dto.messages) {
      const startedAt = performance.now();
      const pressed = BUTTON_MESSAGE.exec(message);
      const turn = pressed
        ? await this.pressButton(telegramUserId, pressed[1].trim(), lastButtons)
        : this.toTurn(
            await this.botService.handleGuestMessage({
              telegramUserId,
              text: message,
              profile: { firstName: 'Eval', lastName: 'Bot' },
            }),
          );
      lastButtons = turn.pressable;
      turns.push({
        ...turn.turn,
        message,
        latencyMs: Math.round(performance.now() - startedAt),
      });
    }

    return {
      userId: telegramUserId,
      turns,
      final: turns[turns.length - 1],
      totalLatencyMs: turns.reduce((sum, turn) => sum + turn.latencyMs, 0),
      state: await this.readState(telegramUserId, reservationId),
    };
  }

  /**
   * Toca un botón de la respuesta anterior, como lo haría el huésped. Por ahora solo los de room
   * service, que son los que resuelve el BotService. El botón no queda en el historial del chat.
   */
  private async pressButton(
    telegramUserId: string,
    label: string,
    available: PressableButton[],
  ): Promise<{ turn: Omit<EvalTurn, 'message' | 'latencyMs'>; pressable: [] }> {
    const base = {
      kind: 'reply' as const,
      reply: '',
      action: 'BUTTON',
      buttons: [],
      document: null,
      error: null,
    };
    const button = available.find(
      (candidate) => candidate.text.toLowerCase() === label.toLowerCase(),
    );
    const match = button?.callbackData
      ? ROOM_SERVICE_CALLBACK.exec(button.callbackData)
      : null;
    if (!match) {
      const offered = available.map((candidate) => candidate.text).join(', ');
      return {
        turn: {
          ...base,
          kind: 'error',
          error: `No hay un botón "${label}" en la respuesta anterior (había: ${offered || 'ninguno'})`,
        },
        pressable: [],
      };
    }

    const [, action, orderId] = match;
    const reply = await this.botService.resolveRoomServiceButton(
      telegramUserId,
      action as RoomServiceButton,
      orderId,
    );
    return { turn: { ...base, reply }, pressable: [] };
  }

  private toTurn(result: BotTurnResult): {
    turn: Omit<EvalTurn, 'message' | 'latencyMs'>;
    pressable: PressableButton[];
  } {
    const base = {
      kind: result.kind,
      reply: '',
      action: null,
      buttons: [],
      document: null,
      error: null,
    };
    switch (result.kind) {
      case 'muted':
        return { turn: base, pressable: [] };
      case 'discarded':
        return { turn: { ...base, action: result.action }, pressable: [] };
      case 'handover':
        return { turn: { ...base, reply: result.text }, pressable: [] };
      case 'error':
        return {
          turn: { ...base, reply: result.text, error: result.error },
          pressable: [],
        };
      case 'reply': {
        const pressable = (
          result.keyboard?.reply_markup.inline_keyboard.flat() ?? []
        ).map((button) => ({
          text: button.text,
          callbackData: 'callback_data' in button ? button.callback_data : null,
        }));
        return {
          turn: {
            ...base,
            reply: result.text,
            action: result.action,
            buttons: pressable.map((button) => button.text),
            document: result.document?.filename ?? null,
          },
          pressable,
        };
      }
    }
  }

  /** Lo que quedó en la base después de la conversación: sirve para asserts sin tokens. */
  private async readState(
    telegramUserId: string,
    reservationId: string | null,
  ) {
    this.em.clear();
    const session = await this.em.findOne(ChatSession, { telegramUserId });
    const activeBooking =
      await this.bookingProcessService.getActive(telegramUserId);
    const account = reservationId
      ? (await this.accountService.getForReservation(reservationId)).account
      : null;
    return {
      chatStatus: session?.status ?? null,
      activeBooking: activeBooking && {
        step: activeBooking.step,
        checkIn: activeBooking.checkIn ?? null,
        checkOut: activeBooking.checkOut ?? null,
        capacity: activeBooking.capacity ?? null,
      },
      account: account && {
        balance: account.balance,
        entries: account.entries.map((entry) => ({
          type: entry.type,
          origin: entry.origin,
          amount: entry.amount,
        })),
      },
    };
  }

  private assertValidKey(received: string | undefined): void {
    const expected = this.config.get<string>('EVAL_API_KEY') ?? '';
    const isValid =
      !!expected &&
      !!received &&
      received.length === expected.length &&
      timingSafeEqual(Buffer.from(received), Buffer.from(expected));
    if (!isValid) throw new UnauthorizedException('x-eval-key inválida');
  }
}
