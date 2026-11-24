import { UnauthorizedException } from '@nestjs/common';
import { ChatAction } from '../rag/rag.service';
import { EvalController } from './eval.controller';
import { BotTurnResult } from '../bot/bot.service';
import { roomServiceConfirmKeyboard } from '../telegram/telegram.format';
import {
  AccountEntryOrigin,
  AccountEntryType,
} from '../../infrastructure/database/entities/AccountEntry.entity';

describe('EvalController', () => {
  const EVAL_KEY = 'clave-de-prueba';
  const ORDER_ID = '3c9a3c55-2b1f-4f5e-9d38-6c7a2f1b0a11';
  let botService: {
    handleGuestMessage: jest.Mock;
    resolveRoomServiceButton: jest.Mock;
  };
  let fixtures: { seedStay: jest.Mock };
  let accountService: { getForReservation: jest.Mock };
  let controller: EvalController;

  beforeEach(() => {
    botService = {
      handleGuestMessage: jest.fn(),
      resolveRoomServiceButton: jest.fn(),
    };
    fixtures = { seedStay: jest.fn().mockResolvedValue('reserva-1') };
    accountService = {
      getForReservation: jest.fn().mockResolvedValue({ account: null }),
    };
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
      fixtures as never,
      accountService as never,
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
    expect(result.state).toEqual({
      chatStatus: 'BOT',
      activeBooking: null,
      account: null,
    });
    expect(fixtures.seedStay).not.toHaveBeenCalled();
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

  describe('huésped alojado y botones (US-27)', () => {
    const summary: BotTurnResult = {
      kind: 'reply',
      text: 'Tu pedido de room service',
      action: ChatAction.PREPARE_ROOM_SERVICE_ORDER,
      keyboard: roomServiceConfirmKeyboard(ORDER_ID, true),
    };

    it('con account crea la estadía con la cuenta y devuelve el estado de la cuenta', async () => {
      botService.handleGuestMessage.mockResolvedValue({ kind: 'muted' });
      accountService.getForReservation.mockResolvedValue({
        account: {
          balance: 3000,
          entries: [
            {
              type: AccountEntryType.CHARGE,
              origin: AccountEntryOrigin.ROOM_SERVICE,
              amount: 3000,
              description: 'Room service: 2 x Café',
            },
          ],
        },
      });

      const result = await controller.conversation(EVAL_KEY, {
        messages: ['hola'],
        account: true,
      });

      expect(fixtures.seedStay).toHaveBeenCalledWith(result.userId, true);
      expect(accountService.getForReservation).toHaveBeenCalledWith(
        'reserva-1',
      );
      expect(result.state.account).toEqual({
        balance: 3000,
        entries: [
          {
            type: AccountEntryType.CHARGE,
            origin: AccountEntryOrigin.ROOM_SERVICE,
            amount: 3000,
          },
        ],
      });
    });

    it('con stay crea la estadía sin cuenta', async () => {
      botService.handleGuestMessage.mockResolvedValue({ kind: 'muted' });

      const result = await controller.conversation(EVAL_KEY, {
        messages: ['hola'],
        stay: true,
      });

      expect(fixtures.seedStay).toHaveBeenCalledWith(result.userId, false);
    });

    it('[botón] toca el botón de la respuesta anterior', async () => {
      botService.handleGuestMessage.mockResolvedValue(summary);
      botService.resolveRoomServiceButton.mockResolvedValue(
        'Lo cargué a la cuenta de tu habitación',
      );

      const result = await controller.conversation(EVAL_KEY, {
        messages: ['quiero un café', '[botón] cargar a la habitación'],
      });

      expect(result.turns[0].buttons).toEqual([
        'Pagar ahora',
        'Cargar a la habitación',
        'No, gracias',
      ]);
      expect(botService.resolveRoomServiceButton).toHaveBeenCalledWith(
        result.userId,
        'charge',
        ORDER_ID,
      );
      expect(botService.handleGuestMessage).toHaveBeenCalledTimes(1);
      expect(result.final).toMatchObject({
        kind: 'reply',
        action: 'BUTTON',
        reply: 'Lo cargué a la cuenta de tu habitación',
        buttons: [],
      });
    });

    it('un botón que no estaba en la respuesta anterior es un error del caso', async () => {
      botService.handleGuestMessage.mockResolvedValue({
        ...summary,
        keyboard: roomServiceConfirmKeyboard(ORDER_ID, false),
      });

      const result = await controller.conversation(EVAL_KEY, {
        messages: ['quiero un café', '[botón] Cargar a la habitación'],
      });

      expect(botService.resolveRoomServiceButton).not.toHaveBeenCalled();
      expect(result.final.kind).toBe('error');
      expect(result.final.error).toContain('Pagar ahora');
    });
  });
});
