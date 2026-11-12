import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MikroORM } from '@mikro-orm/core';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Middleware, Context, Telegram } from 'telegraf';
import {
  ChatSession,
  GuestLanguage,
} from '../../infrastructure/database/entities/ChatSession.entity';
import {
  EXPIRED_DECLINE_LABEL,
  EXPIRED_RESUME_LABEL,
  ROOM_SERVICE_CANCEL_LABEL,
  ROOM_SERVICE_CONFIRM_LABEL,
  ROOM_SERVICE_KEEP_LABEL,
} from '../telegram/telegram.format';
import { detectLanguage } from './language.detector';

const TRANSLATION_MODEL = 'gemini-flash-lite-latest';

const LANGUAGE_NAMES: Record<GuestLanguage, string> = {
  [GuestLanguage.ES]: 'Spanish',
  [GuestLanguage.EN]: 'English',
};

/** Métodos de la API de Telegram que llevan texto para el huésped. */
const TEXT_FIELDS: Record<string, 'text' | 'caption'> = {
  sendMessage: 'text',
  editMessageText: 'text',
  sendPhoto: 'caption',
  sendDocument: 'caption',
  editMessageCaption: 'caption',
};

/** Los botones son pocos y fijos: van traducidos a mano, sin pasar por Gemini. */
const BUTTON_LABELS: Partial<Record<GuestLanguage, Record<string, string>>> = {
  [GuestLanguage.EN]: {
    [EXPIRED_RESUME_LABEL]: 'Resume booking',
    // EXPIRED_DECLINE_LABEL y ROOM_SERVICE_DISCARD_LABEL son el mismo texto ("No, gracias").
    [EXPIRED_DECLINE_LABEL]: 'No, thanks',
    [ROOM_SERVICE_CONFIRM_LABEL]: 'Confirm order',
    [ROOM_SERVICE_CANCEL_LABEL]: 'Yes, cancel',
    [ROOM_SERVICE_KEEP_LABEL]: 'No, keep it',
  },
};

const CACHE_SIZE = 300;

const WRAPPED = Symbol('guestLanguageWrapped');

type InlineButton = { text: string } & Record<string, unknown>;

type TelegramPayload = Record<string, unknown> & {
  chat_id?: string | number;
  reply_markup?: { inline_keyboard?: InlineButton[][] };
};

type CallApi = (
  method: string,
  payload: TelegramPayload,
  options?: unknown,
) => Promise<unknown>;

/**
 * Hace que Chamber le hable a cada huésped en su idioma. Los textos del sistema (ofertas, links
 * de pago, avisos de spa, recordatorios, errores...) están escritos en español en cada módulo;
 * en vez de duplicarlos, se traducen con Gemini justo cuando salen hacia Telegram, según el
 * idioma guardado en el chat. Los chats en español no pagan ninguna llamada extra.
 */
@Injectable()
export class GuestLanguageService {
  private readonly logger = new Logger(GuestLanguageService.name);
  private readonly genAI: GoogleGenerativeAI | null;
  private readonly cache = new Map<string, string>();

  constructor(
    private readonly orm: MikroORM,
    configService: ConfigService,
  ) {
    const apiKey = configService.get<string>('GEMINI_API_KEY');
    this.genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
  }

  /**
   * Actualiza el idioma del chat según lo que escribió el huésped. Los mensajes neutros
   * ("ok", "👍", una fecha) no lo cambian.
   */
  applyDetectedLanguage(session: ChatSession, text: string): void {
    const detected = detectLanguage(text);
    if (detected) session.language = detected;
  }

  async getLanguage(telegramUserId: string): Promise<GuestLanguage> {
    const session = await this.orm.em
      .fork()
      .findOne(ChatSession, { telegramUserId }, { fields: ['language'] });
    return session?.language ?? GuestLanguage.ES;
  }

  /**
   * Traduce un mensaje del sistema (escrito en español) al idioma del huésped. Si algo falla,
   * devuelve el original: mejor un mensaje en español que uno que no llega.
   */
  async translate(text: string, language: GuestLanguage): Promise<string> {
    if (language === GuestLanguage.ES || !text.trim()) return text;
    // Lo que redacta Gemini ya sale en el idioma del huésped.
    if (detectLanguage(text) === language) return text;

    const cacheKey = `${language}:${text}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    if (!this.genAI) return text;

    try {
      const model = this.genAI.getGenerativeModel({
        model: TRANSLATION_MODEL,
        systemInstruction: this.buildInstruction(language),
        generationConfig: { temperature: 0 },
      });
      const result = await model.generateContent(text);
      const translated = stripCodeFence(result.response.text());

      if (!translated || !preservesMarkup(text, translated)) {
        this.logger.warn(
          `Traducción descartada (cambió el formato o vino vacía); se envía el original`,
        );
        return text;
      }

      this.remember(cacheKey, translated);
      return translated;
    } catch (error) {
      this.logger.warn(`No se pudo traducir un mensaje: ${String(error)}`);
      return text;
    }
  }

  /**
   * Intercepta las llamadas a la API de Telegram de un cliente y traduce el texto, la leyenda y
   * los botones antes de mandarlos. Se aplica al bot (avisos que salen desde los servicios) y,
   * por middleware, al cliente de cada update (respuestas con `ctx.reply`).
   */
  wrapTelegram(telegram: Telegram): void {
    const target = telegram as unknown as {
      callApi?: CallApi;
      [WRAPPED]?: boolean;
    };
    if (typeof target.callApi !== 'function' || target[WRAPPED]) return;

    const callApi = target.callApi.bind(telegram) as CallApi;
    target.callApi = async (method, payload, options) =>
      callApi(method, await this.localizePayload(method, payload), options);
    target[WRAPPED] = true;
  }

  middleware(): Middleware<Context> {
    return (ctx, next) => {
      this.wrapTelegram(ctx.telegram);
      return next();
    };
  }

  async localizePayload(
    method: string,
    payload: TelegramPayload,
  ): Promise<TelegramPayload> {
    const field = TEXT_FIELDS[method];
    if (!field || payload?.chat_id === undefined) return payload;

    try {
      const language = await this.getLanguage(String(payload.chat_id));
      if (language === GuestLanguage.ES) return payload;

      const localized: TelegramPayload = { ...payload };
      const text = payload[field];
      if (typeof text === 'string')
        localized[field] = await this.translate(text, language);

      const keyboard = payload.reply_markup?.inline_keyboard;
      if (keyboard) {
        const labels = BUTTON_LABELS[language] ?? {};
        localized.reply_markup = {
          ...payload.reply_markup,
          inline_keyboard: keyboard.map((row) =>
            row.map((button) => ({
              ...button,
              text: labels[button.text] ?? button.text,
            })),
          ),
        };
      }
      return localized;
    } catch (error) {
      this.logger.warn(
        `No se pudo localizar el mensaje para ${String(payload.chat_id)}: ${String(error)}`,
      );
      return payload;
    }
  }

  private buildInstruction(language: GuestLanguage): string {
    const target = LANGUAGE_NAMES[language];
    return [
      `You translate the messages that Chamber, a hotel's virtual assistant, sends to a guest on Telegram. Translate the message into ${target}.`,
      'Reply ONLY with the translated message: no preamble, notes, quotes or code fences.',
      'Keep a warm, friendly and natural tone.',
      'Keep exactly as they are: HTML tags and their attributes (<b>, <i>, <a href="...">), URLs, emojis, line breaks, numbers, prices and amounts, dates and times (in the same format as written), people\'s names, the assistant\'s name (Chamber) and promotion titles.',
      `If the message is already in ${target}, return it unchanged.`,
    ].join('\n');
  }

  private remember(key: string, value: string): void {
    if (this.cache.size >= CACHE_SIZE) {
      const [oldest] = this.cache.keys();
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, value);
  }
}

function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/, '')
    .trim();
}

const TAG = /<\/?([a-z]+)[^>]*>/gi;
const URL = /https?:\/\/[^\s"<>]+/g;

/**
 * Telegram rechaza un mensaje con HTML roto y un link alterado deja al huésped sin poder pagar:
 * la traducción tiene que conservar las mismas etiquetas y las mismas URLs que el original.
 */
export function preservesMarkup(original: string, translated: string): boolean {
  const tags = (text: string) =>
    [...text.matchAll(TAG)]
      .map((match) => (match[0].startsWith('</') ? `/${match[1]}` : match[1]))
      .join(',');
  const urls = (text: string) => (text.match(URL) ?? []).sort().join(' ');
  return (
    tags(original) === tags(translated) && urls(original) === urls(translated)
  );
}
