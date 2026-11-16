import { UnauthorizedException } from '@nestjs/common';
import { ChatAction } from '../rag/rag.service';
import { EvalController } from './eval.controller';
import { BotTurnResult } from '../bot/bot.service';

describe('EvalController', () => {
  const EVAL_KEY = 'clave-de-prueba';
  let botService: { handleGuestMessage: jest.Mock };
  let controller: EvalController;

  beforeEach(() => {
    botService = { handleGuestMessage: jest.fn() };
    const bookingProcessService = {
      getActive: jest.fn().mockResolvedValue(null),
    };
    const config = { get: jest.fn().mockReturnValue(EVAL_KEY) };
    const em = {
      clear: jest.fn(),
      findOne: jest.fn().mockResolvedValue({ status: 'BOT' }),
    };
    controller = new EvalController(
      botService as never,
      bookingProcessService as never,
      config as never,
      em as never,
    );
  });

  it('rechaza el request sin la clave correcta', async () => {
    await expect(
      controller.conversation('otra-clave', { messages: ['hola'] }),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      controller.conversation(undefined, { messages: ['hola'] }),
    ).rejects.toThrow(UnauthorizedException);
    expect(botService.handleGuestMessage).not.toHaveBeenCalled();
  });

  it('manda los mensajes en orden con el mismo huésped y devuelve cada turno', async () => {
    const replies: BotTurnResult[] = [
      { kind: 'reply', text: '¿Para qué fechas?', action: ChatAction.REPLY },
      { kind: 'handover', text: 'Te paso con recepción', muted: true },
    ];
    replies.forEach((reply) =>
      botService.handleGuestMessage.mockResolvedValueOnce(reply),
    );

    const result = await controller.conversation(EVAL_KEY, {
      messages: ['quiero reservar', 'quiero hablar con una persona'],
    });

    const calls = botService.handleGuestMessage.mock.calls.map(
      ([input]) => input as { telegramUserId: string; text: string },
    );
    expect(calls.map((call) => call.text)).toEqual([
      'quiero reservar',
      'quiero hablar con una persona',
    ]);
    expect(calls[0].telegramUserId).toMatch(/^eval-/);
    expect(calls[1].telegramUserId).toBe(calls[0].telegramUserId);

    expect(result.userId).toBe(calls[0].telegramUserId);
    expect(result.turns).toHaveLength(2);
    expect(result.turns[0]).toMatchObject({
      kind: 'reply',
      reply: '¿Para qué fechas?',
      action: ChatAction.REPLY,
    });
    expect(result.final).toMatchObject({
      kind: 'handover',
      reply: 'Te paso con recepción',
      action: null,
    });
    expect(result.state).toEqual({ chatStatus: 'BOT', activeBooking: null });
  });

  it('respeta el userId que le pasan para seguir una conversación', async () => {
    botService.handleGuestMessage.mockResolvedValue({ kind: 'muted' });

    const result = await controller.conversation(EVAL_KEY, {
      messages: ['hola'],
      userId: 'eval-fijo',
    });

    expect(result.userId).toBe('eval-fijo');
    expect(result.final).toMatchObject({ kind: 'muted', reply: '' });
  });
});
