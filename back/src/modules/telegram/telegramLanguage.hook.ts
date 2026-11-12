import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { GuestLanguageService } from '../guestLanguage/guestLanguage.service';

/**
 * Traduce los avisos que los servicios mandan con `bot.telegram.sendMessage` (pago acreditado,
 * turnos, recordatorios, campañas...). Las respuestas con `ctx.reply` usan otro cliente por
 * cada update y se cubren con el middleware de GuestLanguageService (ver app.module).
 */
@Injectable()
export class TelegramLanguageHook implements OnModuleInit {
  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private readonly guestLanguage: GuestLanguageService,
  ) {}

  onModuleInit(): void {
    this.guestLanguage.wrapTelegram(this.bot.telegram);
  }
}
