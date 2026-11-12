import { Test } from '@nestjs/testing';
import { getBotToken } from 'nestjs-telegraf';
import { ChatService } from '../chat/chat.service';
import { ReservationExpirationService } from './reservationExpiration.service';
import { ReservationRepository } from './reservation.repository';
import { ReservationService } from './reservation.service';

const NOW = new Date('2026-10-28T15:00:00.000Z');

const reservation = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  telegramUserId: '123',
  checkIn: '2026-11-10',
  checkOut: '2026-11-12',
  depositAmount: 30000,
  expiresAt: new Date('2026-10-28T15:05:00.000Z'),
  ...overrides,
});

describe('ReservationExpirationService', () => {
  let service: ReservationExpirationService;
  let repository: {
    findDueForExpiration: jest.Mock;
    expireIfPending: jest.Mock;
    findDueForReminder: jest.Mock;
    markReminderSent: jest.Mock;
  };
  let chat: { getOrCreateSession: jest.Mock; recordBotMessage: jest.Mock };
  let bot: { telegram: { sendMessage: jest.Mock } };

  beforeEach(async () => {
    repository = {
      findDueForExpiration: jest.fn().mockResolvedValue([]),
      expireIfPending: jest.fn().mockResolvedValue(true),
      findDueForReminder: jest.fn().mockResolvedValue([]),
      markReminderSent: jest.fn().mockResolvedValue(true),
    };
    chat = {
      getOrCreateSession: jest.fn().mockResolvedValue({ id: 'chat-1' }),
      recordBotMessage: jest.fn().mockResolvedValue({}),
    };
    bot = { telegram: { sendMessage: jest.fn().mockResolvedValue({}) } };

    const module = await Test.createTestingModule({
      providers: [
        ReservationExpirationService,
        { provide: ReservationRepository, useValue: repository },
        {
          provide: ReservationService,
          useValue: {
            buildExpirationNotice: jest.fn().mockReturnValue('venció'),
            buildPaymentReminder: jest.fn().mockReturnValue('recordatorio'),
          },
        },
        { provide: ChatService, useValue: chat },
        { provide: getBotToken(), useValue: bot },
      ],
    }).compile();

    service = module.get(ReservationExpirationService);
  });

  describe('expireOverdue', () => {
    it('vence las reservas atrasadas y le ofrece al huésped retomarlas con botones', async () => {
      repository.findDueForExpiration.mockResolvedValue([reservation()]);

      const expired = await service.expireOverdue(NOW);

      expect(expired).toBe(1);
      expect(repository.findDueForExpiration).toHaveBeenCalledWith(NOW);
      expect(repository.expireIfPending).toHaveBeenCalledWith(reservation().id);
      const [chatId, text, extra] = bot.telegram.sendMessage.mock.calls[0] as [
        string,
        string,
        { reply_markup: unknown },
      ];
      expect(chatId).toBe('123');
      expect(text).toBe('venció');
      expect(JSON.stringify(extra.reply_markup)).toContain(
        `expired:resume:${reservation().id}`,
      );
      expect(JSON.stringify(extra.reply_markup)).toContain(
        `expired:decline:${reservation().id}`,
      );
      expect(chat.recordBotMessage).toHaveBeenCalledWith(
        { id: 'chat-1' },
        'venció',
      );
    });

    it('vence las reservas manuales sin mandar avisos', async () => {
      repository.findDueForExpiration.mockResolvedValue([
        reservation({ telegramUserId: undefined }),
      ]);

      expect(await service.expireOverdue(NOW)).toBe(1);
      expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
    });

    it('no avisa si la reserva se confirmó justo antes de vencer', async () => {
      repository.findDueForExpiration.mockResolvedValue([reservation()]);
      repository.expireIfPending.mockResolvedValue(false);

      expect(await service.expireOverdue(NOW)).toBe(0);
      expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
    });

    it('si Telegram falla, la reserva queda vencida igual', async () => {
      repository.findDueForExpiration.mockResolvedValue([reservation()]);
      bot.telegram.sendMessage.mockRejectedValue(new Error('bot bloqueado'));

      expect(await service.expireOverdue(NOW)).toBe(1);
      expect(chat.recordBotMessage).not.toHaveBeenCalled();
    });
  });

  describe('sendReminders', () => {
    it('busca las que vencen dentro de los próximos 10 minutos', async () => {
      await service.sendReminders(NOW);

      expect(repository.findDueForReminder).toHaveBeenCalledWith(
        NOW,
        new Date('2026-10-28T15:10:00.000Z'),
      );
    });

    it('manda el recordatorio y lo deja en el chat', async () => {
      repository.findDueForReminder.mockResolvedValue([reservation()]);

      expect(await service.sendReminders(NOW)).toBe(1);
      expect(repository.markReminderSent).toHaveBeenCalledWith(
        reservation().id,
        NOW,
      );
      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
        '123',
        'recordatorio',
        { parse_mode: 'HTML' },
      );
      expect(chat.recordBotMessage).toHaveBeenCalledWith(
        { id: 'chat-1' },
        'recordatorio',
      );
    });

    it('no lo manda dos veces si otra corrida ya lo marcó', async () => {
      repository.findDueForReminder.mockResolvedValue([reservation()]);
      repository.markReminderSent.mockResolvedValue(false);

      expect(await service.sendReminders(NOW)).toBe(0);
      expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
    });
  });

  it('el cron no revienta si falla la base', async () => {
    repository.findDueForExpiration.mockRejectedValue(new Error('db caída'));

    await expect(service.handleExpirationCron()).resolves.toBeUndefined();
  });
});
