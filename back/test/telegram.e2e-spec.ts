import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from './../src/app.module';
import { TelegramUpdate } from '../src/modules/telegram/telegram.update';
import { RagService, ChatAction } from '../src/modules/rag/rag.service';
import { PaymentService } from '../src/modules/payment/payment.service';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { Room, RoomStatus } from '../src/infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../src/infrastructure/database/entities/RoomCategory.entity';
import { Reservation } from '../src/infrastructure/database/entities/Reservation.entity';
import { BookingProcess } from '../src/infrastructure/database/entities/BookingProcess.entity';
import { getBotToken } from 'nestjs-telegraf';
import { ChatMessage, MessageRole } from '../src/infrastructure/database/entities/ChatMessage.entity';
import { ChatSession, ChatSessionStatus } from '../src/infrastructure/database/entities/ChatSession.entity';
import { HANDOVER_REPLY } from '../src/modules/chat/chat.service';

describe('Telegram Flow (e2e)', () => {
  let app: INestApplication;
  let telegramUpdate: TelegramUpdate;
  let em: EntityManager;
  let ragServiceMock: any;
  let uniqueRoomNumber: string;
  let seededCategory: RoomCategory;
  let seededRoom: Room;
  const testTelegramUserIds = ['999888777', '111222333', '555444333', '666555444'];

  beforeAll(async () => {
    ragServiceMock = { askQuestion: jest.fn() };
    const paymentServiceMock = {
      createPreference: jest.fn().mockResolvedValue({ preferenceId: 'pref-e2e', initPoint: 'https://mp.example/pref-e2e' }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RagService)
      .useValue(ragServiceMock)
      .overrideProvider(PaymentService)
      .useValue(paymentServiceMock)
      .overrideProvider(getBotToken())
      .useValue({ launch: jest.fn(), stop: jest.fn(), on: jest.fn(), start: jest.fn(), use: jest.fn(), telegram: { sendMessage: jest.fn() } })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    const orm = app.get(MikroORM);
    em = orm.em.fork();

    telegramUpdate = app.get<TelegramUpdate>(TelegramUpdate);

    const uniqueSuffix = Date.now();
    uniqueRoomNumber = `101-${uniqueSuffix}`;
    
    seededCategory = em.create(RoomCategory, {
      name: `Suite E2E-${uniqueSuffix}`,
      capacity: 2,
      basePrice: 15000
    });

    seededRoom = em.create(Room, {
      roomNumber: uniqueRoomNumber,
      category: seededCategory,
      status: RoomStatus.ACTIVE
    });

    await em.flush();
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(Reservation, { telegramUserId: { $in: testTelegramUserIds } });
      await em.nativeDelete(BookingProcess, { telegramUserId: { $in: testTelegramUserIds } });
      await em.nativeDelete(ChatMessage, { telegramUserId: { $in: testTelegramUserIds } });
      await em.nativeDelete(ChatSession, { telegramUserId: { $in: testTelegramUserIds } });
      await em.nativeDelete(Room, { id: seededRoom.id });
      await em.nativeDelete(RoomCategory, { id: seededCategory.id });

      if (app) await app.close();
    } catch (e) {
    }
  });

  it('Flujo completo: Debería consultar disponibilidad y luego confirmar la reserva en BD', async () => {
    const mockCtx = {
      from: { id: 999888777 },
      sendChatAction: jest.fn(),
      reply: jest.fn(),
    } as any;

    ragServiceMock.askQuestion.mockResolvedValueOnce({
      texto: '',
      action: ChatAction.SEARCH_AVAILABILITY,
      datos: { checkIn: '01-11-2026', checkOut: '05-11-2026', capacity: 2 }
    });

    await telegramUpdate.onMessage('Quiero reservar para 2 en noviembre', mockCtx);

    em.clear(); 

    const booking = await em.findOne(BookingProcess, { telegramUserId: '999888777' });
    expect(booking).toBeDefined();
    expect(booking?.step).toBe('PENDING_CONFIRMATION');
    expect(booking?.checkIn).toBe('01-11-2026');

    ragServiceMock.askQuestion.mockResolvedValueOnce({
      texto: '',
      action: ChatAction.CONFIRM_RESERVATION,
      datos: { fullName: 'Juan Pérez', dni: '30111222' }
    });

    await telegramUpdate.onMessage('Perfecto, confirmalo', mockCtx);

    em.clear();

    const reservation = await em.findOne(Reservation, { telegramUserId: '999888777' }, { populate: ['room'] });
    expect(reservation).toBeDefined();
    expect(Number(reservation?.totalAmount)).toBe(60000);
    expect(reservation?.room.roomNumber).toBe(uniqueRoomNumber);
    expect(reservation?.guestFullName).toBe('Juan Pérez');
    expect(reservation?.guestDni).toBe('30111222');
    expect(reservation?.mpPreferenceId).toBe('pref-e2e');
    expect(reservation?.mpInitPoint).toBe('https://mp.example/pref-e2e');

    const completedBooking = await em.findOne(BookingProcess, { id: booking?.id });
    expect(completedBooking?.step).toBe('COMPLETED');
  });

  it('Flujo sin disponibilidad: debería reintentar con otra capacidad reutilizando el mismo booking', async () => {
    const otherTelegramUserId = '111222333';
    const mockCtx = {
      from: { id: 111222333 },
      sendChatAction: jest.fn(),
      reply: jest.fn(),
    } as any;

    ragServiceMock.askQuestion.mockResolvedValueOnce({
      texto: '',
      action: ChatAction.SEARCH_AVAILABILITY,
      datos: { checkIn: '01-12-2026', checkOut: '05-12-2026', capacity: 99 }
    });

    await telegramUpdate.onMessage('Quiero reservar para 99 personas', mockCtx);

    em.clear();

    let booking = await em.findOne(BookingProcess, { telegramUserId: otherTelegramUserId });
    expect(booking).toBeDefined();
    expect(booking?.step).toBe('IN_PROGRESS');
    expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('no nos quedan habitaciones'), { parse_mode: 'HTML' });

    const firstBookingId = booking?.id;

    ragServiceMock.askQuestion.mockResolvedValueOnce({
      texto: '',
      action: ChatAction.SEARCH_AVAILABILITY,
      datos: { checkIn: '01-12-2026', checkOut: '05-12-2026', capacity: 2 }
    });

    await telegramUpdate.onMessage('Probemos con 2 personas', mockCtx);

    em.clear();

    booking = await em.findOne(BookingProcess, { telegramUserId: otherTelegramUserId });
    expect(booking?.id).toBe(firstBookingId);
    expect(booking?.step).toBe('PENDING_CONFIRMATION');
    expect(booking?.capacity).toBe(2);
  });

  describe('US-11: derivación a un operador humano', () => {
    const buildCtx = (telegramUserId: string) => ({
      from: { id: Number(telegramUserId) },
      sendChatAction: jest.fn(),
      reply: jest.fn(),
    } as any);

    it('CA1: pedir hablar con una persona deriva y deja la sesión esperando a un humano', async () => {
      const telegramUserId = '555444333';
      const mockCtx = buildCtx(telegramUserId);
      ragServiceMock.askQuestion.mockClear();

      await telegramUpdate.onMessage('quiero hablar con una persona', mockCtx);

      // El atajo determinista corta antes de gastar una llamada a Gemini.
      expect(ragServiceMock.askQuestion).not.toHaveBeenCalled();
      expect(mockCtx.reply).toHaveBeenCalledWith(HANDOVER_REPLY);

      const session = await em.fork().findOne(ChatSession, { telegramUserId });
      expect(session?.status).toBe(ChatSessionStatus.WAITING_HUMAN);
      expect(session?.handoverRequestedAt).toBeInstanceOf(Date);
    });

    it('CA2: con la conversación en modo humano guarda el mensaje pero no responde', async () => {
      const telegramUserId = '666555444';
      const seedEm = em.fork();
      seedEm.persist(seedEm.create(ChatSession, { telegramUserId, status: ChatSessionStatus.HUMAN }));
      await seedEm.flush();

      const mockCtx = buildCtx(telegramUserId);
      ragServiceMock.askQuestion.mockClear();

      await telegramUpdate.onMessage('¿Hay alguien ahí?', mockCtx);

      expect(ragServiceMock.askQuestion).not.toHaveBeenCalled();
      expect(mockCtx.reply).not.toHaveBeenCalled();
      expect(mockCtx.sendChatAction).not.toHaveBeenCalled();

      const saved = await em.fork().find(ChatMessage, { telegramUserId, content: '¿Hay alguien ahí?' });
      expect(saved).toHaveLength(1);
      expect(saved[0].role).toBe(MessageRole.USER);
    });
  });
});
