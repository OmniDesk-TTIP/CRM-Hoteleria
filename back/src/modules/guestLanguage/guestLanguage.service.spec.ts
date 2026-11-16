import { ConfigService } from '@nestjs/config';
import { MikroORM } from '@mikro-orm/core';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Telegram } from 'telegraf';
import { GuestLanguage } from '../../infrastructure/database/entities/ChatSession.entity';
import { GuestLanguageService, preservesMarkup } from './guestLanguage.service';
import {
  ROOM_SERVICE_CONFIRM_LABEL,
  ROOM_SERVICE_DISCARD_LABEL,
} from '../telegram/telegram.format';

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(),
}));

describe('GuestLanguageService', () => {
  const generateContent = jest.fn();
  const findOne = jest.fn();
  let service: GuestLanguageService;

  const translatesTo = (text: string) =>
    generateContent.mockResolvedValue({ response: { text: () => text } });

  const build = (apiKey: string | undefined = 'fake-key') => {
    (GoogleGenerativeAI as unknown as jest.Mock).mockImplementation(() => ({
      getGenerativeModel: () => ({ generateContent }),
    }));
    const orm = { em: { fork: () => ({ findOne }) } } as unknown as MikroORM;
    const config = { get: () => apiKey } as unknown as ConfigService;
    return new GuestLanguageService(orm, config);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = build();
  });

  describe('translate', () => {
    it('no traduce ni llama a Gemini si el huésped habla español', async () => {
      const result = await service.translate('Hola', GuestLanguage.ES);

      expect(result).toBe('Hola');
      expect(generateContent).not.toHaveBeenCalled();
    });

    it('no traduce lo que ya está en el idioma del huésped', async () => {
      const text = 'Hi! Yes, we have parking for all our guests.';

      expect(await service.translate(text, GuestLanguage.EN)).toBe(text);
      expect(generateContent).not.toHaveBeenCalled();
    });

    it('traduce al inglés conservando el formato', async () => {
      translatesTo('<b>Total:</b> $23000. Pay here: https://mp.example/x');

      const result = await service.translate(
        '<b>Total:</b> $23000. Pagá acá: https://mp.example/x',
        GuestLanguage.EN,
      );

      expect(result).toBe(
        '<b>Total:</b> $23000. Pay here: https://mp.example/x',
      );
    });

    it('reutiliza la traducción de un texto repetido', async () => {
      translatesTo('Thanks for writing to us.');

      await service.translate('Gracias por escribirnos.', GuestLanguage.EN);
      await service.translate('Gracias por escribirnos.', GuestLanguage.EN);

      expect(generateContent).toHaveBeenCalledTimes(1);
    });

    it('si la traducción rompe el HTML o cambia un link, manda el original', async () => {
      const original = 'Pagá acá: <a href="https://mp.example/x">link</a>';
      translatesTo('Pay here: https://mp.example/x');

      expect(await service.translate(original, GuestLanguage.EN)).toBe(
        original,
      );
    });

    it('si Gemini falla, manda el original', async () => {
      generateContent.mockRejectedValue(new Error('503'));

      expect(
        await service.translate('Hubo un error técnico.', GuestLanguage.EN),
      ).toBe('Hubo un error técnico.');
    });

    it('sin API key no traduce', async () => {
      service = build(undefined);

      expect(
        await service.translate('Hubo un error técnico.', GuestLanguage.EN),
      ).toBe('Hubo un error técnico.');
    });
  });

  describe('localizePayload', () => {
    it('traduce el texto y los botones de un huésped que habla inglés', async () => {
      findOne.mockResolvedValue({ language: GuestLanguage.EN });
      translatesTo('Here is your order summary.');

      const localized = await service.localizePayload('sendMessage', {
        chat_id: '123',
        text: 'Este es el resumen de tu pedido.',
        reply_markup: {
          inline_keyboard: [
            [
              { text: ROOM_SERVICE_CONFIRM_LABEL, callback_data: 'a' },
              { text: ROOM_SERVICE_DISCARD_LABEL, callback_data: 'b' },
            ],
          ],
        },
      });

      expect(localized.text).toBe('Here is your order summary.');
      expect(localized.reply_markup?.inline_keyboard).toEqual([
        [
          { text: 'Confirm order', callback_data: 'a' },
          { text: 'No, thanks', callback_data: 'b' },
        ],
      ]);
    });

    it('traduce la leyenda de una foto', async () => {
      findOne.mockResolvedValue({ language: GuestLanguage.EN });
      translatesTo('Romantic getaway');

      const localized = await service.localizePayload('sendPhoto', {
        chat_id: 123,
        caption: 'Escapada romántica',
      });

      expect(localized.caption).toBe('Romantic getaway');
    });

    it('deja igual el mensaje de un huésped que habla español', async () => {
      findOne.mockResolvedValue({ language: GuestLanguage.ES });
      const payload = { chat_id: '123', text: 'Hola' };

      expect(await service.localizePayload('sendMessage', payload)).toBe(
        payload,
      );
      expect(generateContent).not.toHaveBeenCalled();
    });

    it('no toca los métodos sin texto para el huésped', async () => {
      const payload = { chat_id: '123', action: 'typing' };

      expect(await service.localizePayload('sendChatAction', payload)).toBe(
        payload,
      );
      expect(findOne).not.toHaveBeenCalled();
    });

    it('si no puede leer el idioma, manda el mensaje tal cual', async () => {
      findOne.mockRejectedValue(new Error('db caída'));
      const payload = { chat_id: '123', text: 'Hola' };

      expect(await service.localizePayload('sendMessage', payload)).toBe(
        payload,
      );
    });
  });

  describe('wrapTelegram', () => {
    it('traduce lo que se manda por el cliente de Telegram, una sola vez aunque se envuelva dos veces', async () => {
      findOne.mockResolvedValue({ language: GuestLanguage.EN });
      translatesTo('Your payment was received.');
      const callApi = jest.fn().mockResolvedValue({ ok: true });
      const telegram = { callApi } as unknown as Telegram;

      service.wrapTelegram(telegram);
      service.wrapTelegram(telegram);
      await (
        telegram as unknown as {
          callApi: (method: string, payload: object) => Promise<unknown>;
        }
      ).callApi('sendMessage', {
        chat_id: '123',
        text: 'Se acreditó tu pago.',
      });

      expect(callApi).toHaveBeenCalledTimes(1);
      expect(callApi).toHaveBeenCalledWith(
        'sendMessage',
        { chat_id: '123', text: 'Your payment was received.' },
        undefined,
      );
      expect(generateContent).toHaveBeenCalledTimes(1);
    });

    it('ignora un cliente sin callApi (bot simulado en los tests)', () => {
      expect(() => service.wrapTelegram({} as Telegram)).not.toThrow();
    });
  });

  describe('preservesMarkup', () => {
    it('acepta traducciones con las mismas etiquetas y links', () => {
      expect(
        preservesMarkup(
          '<b>Hola</b> <a href="https://x.com/a">pagar</a>',
          '<b>Hi</b> <a href="https://x.com/a">pay</a>',
        ),
      ).toBe(true);
    });

    it('rechaza traducciones que pierden una etiqueta o cambian un link', () => {
      expect(preservesMarkup('<b>Hola</b>', 'Hi')).toBe(false);
      expect(preservesMarkup('https://x.com/a', 'https://x.com/b')).toBe(false);
    });
  });
});
