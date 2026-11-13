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
import { BotService, BotTurnResult } from '../bot/bot.service';
import { BookingProcessService } from '../bookingProcess/bookingProcess.service';
import { ChatSession } from '../../infrastructure/database/entities/ChatSession.entity';
import { EvalConversationDto } from './dto/evalConversation.dto';

export interface EvalTurn {
  message: string;
  kind: BotTurnResult['kind'];
  /** Lo que vería el huésped. Vacío si el bot no contestó (chat silenciado). */
  reply: string;
  /** Acción que eligió Gemini (REPLY, SEARCH_AVAILABILITY, ...). Null en handover/error/muted. */
  action: string | null;
  buttons: string[];
  document: string | null;
  error: string | null;
  latencyMs: number;
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
    const turns: EvalTurn[] = [];

    for (const message of dto.messages) {
      const startedAt = performance.now();
      const result = await this.botService.handleGuestMessage({
        telegramUserId,
        text: message,
        profile: { firstName: 'Eval', lastName: 'Bot' },
      });
      turns.push(
        this.toTurn(message, result, Math.round(performance.now() - startedAt)),
      );
    }

    return {
      userId: telegramUserId,
      turns,
      final: turns[turns.length - 1],
      totalLatencyMs: turns.reduce((sum, turn) => sum + turn.latencyMs, 0),
      state: await this.readState(telegramUserId),
    };
  }

  private toTurn(
    message: string,
    result: BotTurnResult,
    latencyMs: number,
  ): EvalTurn {
    const base = {
      message,
      kind: result.kind,
      reply: '',
      action: null,
      buttons: [],
      document: null,
      error: null,
      latencyMs,
    };
    switch (result.kind) {
      case 'muted':
        return base;
      case 'discarded':
        return { ...base, action: result.action };
      case 'handover':
        return { ...base, reply: result.text };
      case 'error':
        return { ...base, reply: result.text, error: result.error };
      case 'reply':
        return {
          ...base,
          reply: result.text,
          action: result.action,
          buttons:
            result.keyboard?.reply_markup.inline_keyboard
              .flat()
              .map((button) => button.text) ?? [],
          document: result.document?.filename ?? null,
        };
    }
  }

  /** Lo que quedó en la base después de la conversación: sirve para asserts sin tokens. */
  private async readState(telegramUserId: string) {
    this.em.clear();
    const session = await this.em.findOne(ChatSession, { telegramUserId });
    const activeBooking =
      await this.bookingProcessService.getActive(telegramUserId);
    return {
      chatStatus: session?.status ?? null,
      activeBooking: activeBooking && {
        step: activeBooking.step,
        checkIn: activeBooking.checkIn ?? null,
        checkOut: activeBooking.checkOut ?? null,
        capacity: activeBooking.capacity ?? null,
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
