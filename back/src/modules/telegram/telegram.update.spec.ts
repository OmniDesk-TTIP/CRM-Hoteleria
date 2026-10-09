import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager, MikroORM } from '@mikro-orm/core';
import { TelegramUpdate } from './telegram.update';
import { RagService, ChatAction } from '../rag/rag.service';
import { ReservationService } from '../reservation/reservation.service';
import { BookingProcessService } from '../bookingProcess/bookingProcess.service';
import { BookingProcessStep } from '../../infrastructure/database/entities/BookingProcess.entity';
import { ChatService, HANDOVER_REPLY } from '../chat/chat.service';
import { SpaService } from '../spa/spa.service';
import { SpaReservationService } from '../spaReservation/spaReservation.service';
import {
  ChatSessionStatus,
  HandoverReason,
} from '../../infrastructure/database/entities/ChatSession.entity';

describe('TelegramUpdate', () => {
  let update: TelegramUpdate;
  let ragService: RagService;
  let reservationService: ReservationService;
  let bookingProcessService: BookingProcessService;
  let em: EntityManager;
  let chatService: any;
  let spaService: { getGuestContextBlock: jest.Mock };
  let spaReservationService: { requestSpa: jest.Mock };
  let session: any;

  const mockTelegramUserId = '123456789';
  let mockCtx: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramUpdate,
        {
          provide: RagService,
          useValue: {
            askQuestion: jest.fn(),
            composeUnavailableReply: jest.fn(),
          },
        },
        {
          provide: ReservationService,
          useValue: {
            searchAvailability: jest.fn(),
            confirmReservation: jest.fn(),
          },
        },
        {
          provide: BookingProcessService,
          useValue: {
            getActive: jest.fn(),
            getLastCompleted: jest.fn(),
          },
        },
        {
          provide: ChatService,
          useValue: {
            getOrCreateSession: jest.fn(),
            recordIncomingMessage: jest.fn(),
            recordBotMessage: jest.fn(),
            recordSystemMessage: jest.fn(),
            requestHandover: jest.fn(),
            registerBotFailure: jest.fn(),
            resetBotFailures: jest.fn(),
            wasTakenOverMeanwhile: jest.fn(),
            isMuted: jest.fn(),
          },
        },
        {
          provide: SpaService,
          useValue: { getGuestContextBlock: jest.fn() },
        },
        {
          provide: SpaReservationService,
          useValue: { requestSpa: jest.fn() },
        },
        {
          provide: MikroORM,
          // RequestContext.create forkea este em; el TelegramUpdate sigue usando el EntityManager inyectado.
          useValue: { em: { fork: () => ({ name: 'default' }) } },
        },
        {
          provide: EntityManager,
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn().mockImplementation((entity, data) => data),
            persist: jest.fn(),
            flush: jest.fn(),
          },
        },
      ],
    }).compile();

    update = module.get<TelegramUpdate>(TelegramUpdate);
    ragService = module.get<RagService>(RagService);
    reservationService = module.get<ReservationService>(ReservationService);
    bookingProcessService = module.get<BookingProcessService>(
      BookingProcessService,
    );
    em = module.get<EntityManager>(EntityManager);
    chatService = module.get<ChatService>(ChatService);
    spaService = module.get(SpaService);
    spaReservationService = module.get(SpaReservationService);
    spaService.getGuestContextBlock.mockResolvedValue(null);

    jest.spyOn(bookingProcessService, 'getActive').mockResolvedValue(null);
    jest
      .spyOn(bookingProcessService, 'getLastCompleted')
      .mockResolvedValue(null);
    jest.spyOn(em, 'find').mockResolvedValue([]);

    session = {
      id: '8f1d2a1e-0000-4000-8000-000000000001',
      telegramUserId: mockTelegramUserId,
      status: ChatSessionStatus.BOT,
    };
    chatService.getOrCreateSession.mockResolvedValue(session);
    chatService.recordIncomingMessage.mockResolvedValue({ id: 'incoming-1' });
    chatService.recordBotMessage.mockResolvedValue({ id: 'bot-1' });
    chatService.isMuted.mockImplementation(
      (s: any) => s.status !== ChatSessionStatus.BOT,
    );
    chatService.wasTakenOverMeanwhile.mockResolvedValue(false);
    chatService.requestHandover.mockResolvedValue({
      replyText: HANDOVER_REPLY,
      muted: true,
    });
    chatService.registerBotFailure.mockResolvedValue(false);
    chatService.resetBotFailures.mockResolvedValue(undefined);

    mockCtx = {
      from: { id: mockTelegramUserId },
      sendChatAction: jest.fn(),
      reply: jest.fn(),
    };
  });

  it('debería responder un mensaje simple (REPLY)', async () => {
    jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
      texto: 'Hola, soy Chamber',
      action: ChatAction.REPLY,
    });

    await update.onMessage('Hola', mockCtx);

    expect(mockCtx.reply).toHaveBeenCalledWith('Hola, soy Chamber', {
      parse_mode: 'HTML',
    });
    expect(chatService.recordIncomingMessage).toHaveBeenCalledWith(
      session,
      'Hola',
    );
    expect(chatService.recordBotMessage).toHaveBeenCalledWith(
      session,
      'Hola, soy Chamber',
    );
  });

  it('le pasa a Chamber el bloque de servicios del huésped elegible (CA2/CA3)', async () => {
    spaService.getGuestContextBlock.mockResolvedValue('[SERVICIOS DEL HOTEL]');
    jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
      texto: 'Tenemos spa',
      action: ChatAction.REPLY,
    });

    await update.onMessage('¿Tienen spa?', mockCtx);

    expect(spaService.getGuestContextBlock).toHaveBeenCalledWith(
      mockTelegramUserId,
    );
    expect(ragService.askQuestion).toHaveBeenCalledWith(
      '¿Tienen spa?',
      null,
      [],
      null,
      '[SERVICIOS DEL HOTEL]',
    );
  });

  describe('solicitud de turno de spa (REQUEST_SPA_BOOKING)', () => {
    const datos = {
      serviceId: '5b0f7f8e-6c53-4d3f-9a7c-1f6f1d0f0001',
      date: '08-10-2026',
      time: '15:00',
    };

    it('registra la solicitud y responde con el texto fijo del backend', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.REQUEST_SPA_BOOKING,
        datos,
        texto: 'El turno quedó confirmado',
      });
      spaReservationService.requestSpa.mockResolvedValue({
        ok: true,
        reply: 'Listo, registré tu solicitud',
      });

      await update.onMessage('Quiero un masaje el jueves a las 15', mockCtx);

      expect(spaReservationService.requestSpa).toHaveBeenCalledWith(
        mockTelegramUserId,
        expect.objectContaining(datos),
      );
      expect(mockCtx.reply).toHaveBeenCalledWith(
        'Listo, registré tu solicitud',
        {
          parse_mode: 'HTML',
        },
      );
    });

    it('le explica el motivo si el backend rechaza la solicitud', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.REQUEST_SPA_BOOKING,
        datos,
      });
      spaReservationService.requestSpa.mockResolvedValue({
        ok: false,
        reason: 'Esa fecha ya pasó.',
      });

      await update.onMessage('Quiero un masaje', mockCtx);

      expect(mockCtx.reply).toHaveBeenCalledWith('Esa fecha ya pasó.', {
        parse_mode: 'HTML',
      });
    });

    it('pide los datos que faltan en vez de fallar si los argumentos son inválidos', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.REQUEST_SPA_BOOKING,
        datos: { serviceId: 'no-es-uuid', date: '2026-10-08', time: '3pm' },
      });

      await update.onMessage('Quiero un masaje', mockCtx);

      expect(spaReservationService.requestSpa).not.toHaveBeenCalled();
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('qué servicio querés'),
        { parse_mode: 'HTML' },
      );
    });
  });

  it('no le pasa servicios a un huésped que no es elegible', async () => {
    jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
      texto: 'El spa es para huéspedes con reserva',
      action: ChatAction.REPLY,
    });

    await update.onMessage('¿Tienen spa?', mockCtx);

    expect((ragService.askQuestion as jest.Mock).mock.calls[0][4]).toBeNull();
  });

  it('debería buscar disponibilidad y encontrar habitación (SEARCH_AVAILABILITY)', async () => {
    jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
      texto: '',
      action: ChatAction.SEARCH_AVAILABILITY,
      datos: { checkIn: '10-10-2026', checkOut: '15-10-2026', capacity: 2 },
    });

    jest.spyOn(reservationService, 'searchAvailability').mockResolvedValue({
      available: true,
      reply:
        '¡Buenas noticias! Tenemos disponibilidad en nuestra Suite del 10-10-2026 al 15-10-2026 por $100 la noche.\n\n¿Te gustaría que confirmemos la reserva?',
    });

    await update.onMessage('Quiero reservar', mockCtx);

    expect(reservationService.searchAvailability).toHaveBeenCalledWith(
      mockTelegramUserId,
      null,
      expect.objectContaining({
        checkIn: '10-10-2026',
        checkOut: '15-10-2026',
        capacity: 2,
      }),
    );
    expect(mockCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining(
        '¡Buenas noticias! Tenemos disponibilidad en nuestra Suite',
      ),
      { parse_mode: 'HTML' },
    );
  });

  describe('sin disponibilidad en las fechas pedidas (SEARCH_AVAILABILITY)', () => {
    const datos = {
      checkIn: '10-10-2026',
      checkOut: '15-10-2026',
      capacity: 2,
    };
    const alternatives = [
      {
        checkIn: '12-10-2026',
        checkOut: '17-10-2026',
        nights: 5,
        isShorterStay: false,
        roomCategory: 'Suite <VIP>',
        totalAmount: 500,
      },
    ];

    beforeEach(() => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        texto: '',
        action: ChatAction.SEARCH_AVAILABILITY,
        datos,
      });
    });

    it('le pide a Gemini una respuesta empática con las alternativas y la escapa como HTML', async () => {
      jest
        .spyOn(reservationService, 'searchAvailability')
        .mockResolvedValue({ available: false, alternatives });
      jest
        .spyOn(ragService, 'composeUnavailableReply')
        .mockResolvedValue('Qué pena! Tengo la Suite <VIP> del 12 al 17');

      await update.onMessage('Quiero del 10 al 15', mockCtx);

      expect(ragService.composeUnavailableReply).toHaveBeenCalledWith(
        'Quiero del 10 al 15',
        [],
        expect.objectContaining(datos),
        alternatives,
      );
      expect(mockCtx.reply).toHaveBeenCalledWith(
        'Qué pena! Tengo la Suite &lt;VIP&gt; del 12 al 17',
        { parse_mode: 'HTML' },
      );
    });

    it('lista las alternativas tal cual si Gemini no devuelve texto', async () => {
      jest
        .spyOn(reservationService, 'searchAvailability')
        .mockResolvedValue({ available: false, alternatives });
      jest.spyOn(ragService, 'composeUnavailableReply').mockResolvedValue('');

      await update.onMessage('Quiero del 10 al 15', mockCtx);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining(
          '• Del 12-10-2026 al 17-10-2026 (5 noches) – Suite &lt;VIP&gt;, total $500',
        ),
        { parse_mode: 'HTML' },
      );
    });

    it('responde con el mensaje fijo, sin llamar a Gemini, si tampoco hay fechas cercanas', async () => {
      jest
        .spyOn(reservationService, 'searchAvailability')
        .mockResolvedValue({ available: false, alternatives: [] });

      await update.onMessage('Quiero del 10 al 15', mockCtx);

      expect(ragService.composeUnavailableReply).not.toHaveBeenCalled();
      expect(mockCtx.reply).toHaveBeenCalledWith(
        'Lamentablemente no nos quedan habitaciones para 2 personas en esas fechas ni en los 7 días cercanos. ¿Probamos con otras fechas?',
        { parse_mode: 'HTML' },
      );
    });
  });

  it('debería responder con error técnico si los datos de SEARCH_AVAILABILITY son inválidos', async () => {
    jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
      texto: '',
      action: ChatAction.SEARCH_AVAILABILITY,
      datos: {
        checkIn: 'no-es-una-fecha',
        checkOut: '15-10-2026',
        capacity: 2,
      },
    });

    await update.onMessage('Quiero reservar', mockCtx);

    expect(reservationService.searchAvailability).not.toHaveBeenCalled();
    expect(mockCtx.reply).toHaveBeenCalledWith(
      'Hubo un error técnico al procesar tu consulta. Por favor, intentá nuevamente.',
    );
  });

  it('debería confirmar una reserva si hay un proceso pendiente (CONFIRM_RESERVATION)', async () => {
    const activeBooking: any = {
      telegramUserId: mockTelegramUserId,
      step: 'PENDING_CONFIRMATION',
      checkIn: '10-10-2026',
      checkOut: '15-10-2026',
      capacity: 2,
    };

    jest
      .spyOn(bookingProcessService, 'getActive')
      .mockResolvedValue(activeBooking);
    jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
      texto: '',
      action: ChatAction.CONFIRM_RESERVATION,
      datos: { fullName: 'Juan Pérez', dni: '30111222' },
    });

    jest
      .spyOn(reservationService, 'confirmReservation')
      .mockImplementation((_telegramUserId, booking) => {
        booking.step = BookingProcessStep.COMPLETED;
        return Promise.resolve(
          'Te estoy guardando la Suite del 10-10-2026 al 15-10-2026. Todavía no está confirmada.',
        );
      });

    await update.onMessage('Sí, confirmo', mockCtx);

    expect(activeBooking.step).toBe('COMPLETED');
    expect(mockCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Todavía no está confirmada'),
      { parse_mode: 'HTML' },
    );
    expect(chatService.recordBotMessage).toHaveBeenCalledWith(
      session,
      expect.stringContaining('Todavía no está confirmada'),
    );
  });

  it('debería pedir los datos del huésped en vez de cortar con un error si faltan al confirmar (CONFIRM_RESERVATION)', async () => {
    const activeBooking: any = {
      telegramUserId: mockTelegramUserId,
      step: 'PENDING_CONFIRMATION',
      checkIn: '10-10-2026',
      checkOut: '15-10-2026',
      capacity: 2,
    };

    jest
      .spyOn(bookingProcessService, 'getActive')
      .mockResolvedValue(activeBooking);
    jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
      texto: '',
      action: ChatAction.CONFIRM_RESERVATION,
      datos: { fullName: '', dni: 'no-es-un-dni' },
    });

    await update.onMessage('Sí, confirmo', mockCtx);

    expect(reservationService.confirmReservation).not.toHaveBeenCalled();
    expect(mockCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining('necesito el nombre completo y el DNI'),
      { parse_mode: 'HTML' },
    );
  });

  it('debería pedir solo el DNI si el nombre vino bien pero el DNI no (CONFIRM_RESERVATION)', async () => {
    const activeBooking: any = {
      telegramUserId: mockTelegramUserId,
      step: 'PENDING_CONFIRMATION',
      checkIn: '10-10-2026',
      checkOut: '15-10-2026',
      capacity: 2,
    };

    jest
      .spyOn(bookingProcessService, 'getActive')
      .mockResolvedValue(activeBooking);
    jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
      texto: '',
      action: ChatAction.CONFIRM_RESERVATION,
      datos: { fullName: 'Juan Pérez', dni: '30.111.222' },
    });

    await update.onMessage('Sí, confirmo', mockCtx);

    expect(reservationService.confirmReservation).not.toHaveBeenCalled();
    expect(mockCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining('DNI del huésped'),
      { parse_mode: 'HTML' },
    );
  });

  it('no repite la oferta si el usuario la acepta y el modelo vuelve a buscar los mismos datos (SEARCH_AVAILABILITY)', async () => {
    const activeBooking: any = {
      telegramUserId: mockTelegramUserId,
      step: 'PENDING_CONFIRMATION',
      checkIn: '10-10-2026',
      checkOut: '15-10-2026',
      capacity: 2,
    };

    jest
      .spyOn(bookingProcessService, 'getActive')
      .mockResolvedValue(activeBooking);
    jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
      texto: '',
      action: ChatAction.SEARCH_AVAILABILITY,
      datos: { checkIn: '10-10-2026', checkOut: '15-10-2026', capacity: 2 },
    });

    await update.onMessage('dale', mockCtx);

    expect(reservationService.searchAvailability).not.toHaveBeenCalled();
    expect(mockCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining('necesito el nombre completo y el DNI'),
      { parse_mode: 'HTML' },
    );
  });

  it('sí vuelve a buscar disponibilidad si el usuario cambia las fechas (SEARCH_AVAILABILITY)', async () => {
    const activeBooking: any = {
      telegramUserId: mockTelegramUserId,
      step: 'PENDING_CONFIRMATION',
      checkIn: '10-10-2026',
      checkOut: '15-10-2026',
      capacity: 2,
    };

    jest
      .spyOn(bookingProcessService, 'getActive')
      .mockResolvedValue(activeBooking);
    jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
      texto: '',
      action: ChatAction.SEARCH_AVAILABILITY,
      datos: { checkIn: '20-10-2026', checkOut: '25-10-2026', capacity: 2 },
    });
    jest.spyOn(reservationService, 'searchAvailability').mockResolvedValue({
      available: true,
      reply:
        'Tenemos disponibilidad en nuestra Suite del 20-10-2026 al 25-10-2026.',
    });

    await update.onMessage('mejor del 20 al 25', mockCtx);

    expect(reservationService.searchAvailability).toHaveBeenCalledWith(
      mockTelegramUserId,
      activeBooking,
      expect.objectContaining({
        checkIn: '20-10-2026',
        checkOut: '25-10-2026',
      }),
    );
  });

  describe('US-11: derivación a un operador humano', () => {
    it('CA2: con el chat en modo humano guarda el mensaje pero no llama a la IA ni responde', async () => {
      session.status = ChatSessionStatus.HUMAN;

      await update.onMessage('¿Me confirman el horario del desayuno?', mockCtx);

      expect(chatService.recordIncomingMessage).toHaveBeenCalledWith(
        session,
        '¿Me confirman el horario del desayuno?',
      );
      expect(ragService.askQuestion).not.toHaveBeenCalled();
      expect(mockCtx.reply).not.toHaveBeenCalled();
      expect(mockCtx.sendChatAction).not.toHaveBeenCalled();
    });

    it('CA2: tampoco procesa mientras el pedido está esperando a que alguien lo tome', async () => {
      session.status = ChatSessionStatus.WAITING_HUMAN;

      await update.onMessage('¿Hay alguien?', mockCtx);

      expect(ragService.askQuestion).not.toHaveBeenCalled();
      expect(mockCtx.reply).not.toHaveBeenCalled();
    });

    it('CA1: un pedido explícito deriva sin gastar una llamada a Gemini', async () => {
      await update.onMessage('quiero hablar con una persona', mockCtx);

      expect(ragService.askQuestion).not.toHaveBeenCalled();
      expect(chatService.requestHandover).toHaveBeenCalledWith(
        session,
        HandoverReason.GUEST_REQUEST,
      );
      // Sin parse_mode: es un texto nuestro, plano.
      expect(mockCtx.reply).toHaveBeenCalledWith(HANDOVER_REPLY);
    });

    it('CA1: también deriva cuando el pedido es indirecto y lo detecta el modelo', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.REQUEST_HUMAN,
        datos: { reason: 'El huésped está frustrado' },
      });

      await update.onMessage(
        'no me estás entendiendo nada de lo que te pido',
        mockCtx,
      );

      expect(chatService.requestHandover).toHaveBeenCalledWith(
        session,
        HandoverReason.GUEST_REQUEST,
      );
      expect(chatService.recordBotMessage).not.toHaveBeenCalled();
    });

    it('CA5: fuera de horario el bot avisa y sigue conversando', async () => {
      const outOfHoursReply =
        'En este momento la recepción no está disponible. Ya dejé tu pedido anotado y te van a escribir mañana a las 09:00.';
      chatService.requestHandover.mockResolvedValue({
        replyText: outOfHoursReply,
        muted: false,
      });

      await update.onMessage('necesito un recepcionista', mockCtx);

      expect(mockCtx.reply).toHaveBeenCalledWith(outOfHoursReply);
    });

    it('guarda el mensaje del huésped ANTES de llamar a la IA', async () => {
      jest
        .spyOn(ragService, 'askQuestion')
        .mockResolvedValue({ texto: 'Hola', action: ChatAction.REPLY });

      await update.onMessage('Hola', mockCtx);

      const [persisted] =
        chatService.recordIncomingMessage.mock.invocationCallOrder;
      const [asked] = (ragService.askQuestion as jest.Mock).mock
        .invocationCallOrder;
      expect(persisted).toBeLessThan(asked);
    });

    it('descarta la respuesta si un operador tomó el control mientras la IA pensaba', async () => {
      jest
        .spyOn(ragService, 'askQuestion')
        .mockResolvedValue({ texto: 'Hola', action: ChatAction.REPLY });
      chatService.wasTakenOverMeanwhile.mockResolvedValue(true);

      await update.onMessage('Hola', mockCtx);

      expect(chatService.recordBotMessage).not.toHaveBeenCalled();
      expect(mockCtx.reply).not.toHaveBeenCalled();
    });

    it('cuenta como fallo una respuesta que no resuelve, sin silenciar al bot', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        texto: 'Lamentablemente no tengo esa información en este momento.',
        action: ChatAction.REPLY,
      });

      await update.onMessage('¿Aceptan mascotas exóticas?', mockCtx);

      expect(chatService.registerBotFailure).toHaveBeenCalledWith(session);
      expect(chatService.resetBotFailures).not.toHaveBeenCalled();
      expect(mockCtx.reply).toHaveBeenCalled();
    });

    it('reinicia el contador cuando el bot sí resuelve', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        texto: 'El desayuno se sirve de 7 a 10.',
        action: ChatAction.REPLY,
      });

      await update.onMessage('¿A qué hora es el desayuno?', mockCtx);

      expect(chatService.resetBotFailures).toHaveBeenCalledWith(session);
      expect(chatService.registerBotFailure).not.toHaveBeenCalled();
    });

    it('excluye del historial el mensaje que se acaba de guardar', async () => {
      jest
        .spyOn(ragService, 'askQuestion')
        .mockResolvedValue({ texto: 'Hola', action: ChatAction.REPLY });

      await update.onMessage('Hola', mockCtx);

      expect(em.find).toHaveBeenCalledWith(
        expect.anything(),
        { telegramUserId: mockTelegramUserId, id: { $ne: 'incoming-1' } },
        expect.objectContaining({ limit: 6 }),
      );
    });
  });
});
