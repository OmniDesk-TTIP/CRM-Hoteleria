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
import { CancellationService } from '../cancellation/cancellation.service';
import { RestaurantService } from '../restaurant/restaurant.service';
import { RestaurantReservationService } from '../restaurantReservation/restaurantReservation.service';
import { RoomServiceService } from '../roomService/roomService.service';
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
  let spaService: { getSpaContextBlock: jest.Mock };
  let spaReservationService: { requestSpa: jest.Mock };
  let restaurantService: { getChatContext: jest.Mock };
  let restaurantReservationService: { requestTable: jest.Mock };
  let roomServiceService: {
    getChatContext: jest.Mock;
    prepareOrder: jest.Mock;
    confirmOrder: jest.Mock;
    discardDraft: jest.Mock;
    requestCancel: jest.Mock;
    cancelOrder: jest.Mock;
  };
  let cancellationService: {
    getGuestContextBlock: jest.Mock;
    cancelForGuest: jest.Mock;
    registerRefundAccountForGuest: jest.Mock;
  };
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
            hasPendingPayment: jest.fn().mockResolvedValue(false),
            buildPendingPaymentReply: jest.fn().mockResolvedValue(null),
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
          useValue: { getSpaContextBlock: jest.fn() },
        },
        {
          provide: SpaReservationService,
          useValue: { requestSpa: jest.fn() },
        },
        {
          provide: RestaurantService,
          useValue: { getChatContext: jest.fn() },
        },
        {
          provide: RestaurantReservationService,
          useValue: { requestTable: jest.fn() },
        },
        {
          provide: RoomServiceService,
          useValue: {
            getChatContext: jest.fn(),
            prepareOrder: jest.fn(),
            confirmOrder: jest.fn(),
            discardDraft: jest.fn(),
            requestCancel: jest.fn(),
            cancelOrder: jest.fn(),
          },
        },
        {
          provide: CancellationService,
          useValue: {
            getGuestContextBlock: jest.fn(),
            cancelForGuest: jest.fn(),
            registerRefundAccountForGuest: jest.fn(),
          },
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
    spaService.getSpaContextBlock.mockResolvedValue('[SERVICIOS DEL HOTEL]');
    restaurantService = module.get(RestaurantService);
    restaurantReservationService = module.get(RestaurantReservationService);
    restaurantService.getChatContext.mockResolvedValue({
      block: '[RESTAURANTE]',
      canBook: true,
    });
    roomServiceService = module.get(RoomServiceService);
    roomServiceService.getChatContext.mockResolvedValue({
      block: '[ROOM SERVICE]',
      canOrder: true,
      hasOpenOrder: false,
    });
    cancellationService = module.get(CancellationService);
    cancellationService.getGuestContextBlock.mockResolvedValue({
      block: '[POLÍTICA DE CANCELACIÓN]',
      canCancel: false,
    });

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

  it('le pasa a Chamber el bloque de servicios del spa del cliente (CA3)', async () => {
    spaService.getSpaContextBlock.mockResolvedValue('[SERVICIOS DEL HOTEL]');
    jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
      texto: 'Tenemos spa',
      action: ChatAction.REPLY,
    });

    await update.onMessage('¿Tienen spa?', mockCtx);

    expect(spaService.getSpaContextBlock).toHaveBeenCalledWith(
      mockTelegramUserId,
    );
    expect(ragService.askQuestion).toHaveBeenCalledWith(
      '¿Tienen spa?',
      null,
      [],
      null,
      '[SERVICIOS DEL HOTEL]',
      { block: '[POLÍTICA DE CANCELACIÓN]', canCancel: false },
      false,
      { block: '[RESTAURANTE]', canBook: true },
      { block: '[ROOM SERVICE]', canOrder: true, hasOpenOrder: false },
    );
  });

  it('le pasa a Chamber el contexto del restaurante del cliente (CA2/CA3)', async () => {
    jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
      texto: 'Tenemos restó',
      action: ChatAction.REPLY,
    });

    await update.onMessage('¿Qué hay para cenar?', mockCtx);

    expect(restaurantService.getChatContext).toHaveBeenCalledWith(
      mockTelegramUserId,
    );
  });

  describe('pedido de mesa en el restó (REQUEST_TABLE_BOOKING)', () => {
    const datos = { date: '08-10-2026', time: '21:00', partySize: 2 };

    it('registra el pedido y responde con el texto fijo del backend (CA5)', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.REQUEST_TABLE_BOOKING,
        datos,
      });
      restaurantReservationService.requestTable.mockResolvedValue({
        ok: true,
        reply: 'Listo, registré tu pedido de mesa',
      });

      await update.onMessage('Mesa para 2 el jueves a las 21', mockCtx);

      expect(restaurantReservationService.requestTable).toHaveBeenCalledWith(
        mockTelegramUserId,
        expect.objectContaining(datos),
      );
      expect(mockCtx.reply).toHaveBeenCalledWith(
        'Listo, registré tu pedido de mesa',
        { parse_mode: 'HTML' },
      );
    });

    it('le explica el motivo si el backend rechaza el pedido', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.REQUEST_TABLE_BOOKING,
        datos,
      });
      restaurantReservationService.requestTable.mockResolvedValue({
        ok: false,
        reason: 'Solo puedo pedir mesa para los días de tu estadía.',
      });

      await update.onMessage('Mesa para 2', mockCtx);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        'Solo puedo pedir mesa para los días de tu estadía.',
        { parse_mode: 'HTML' },
      );
    });

    it('pide los datos que faltan si los argumentos son inválidos', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.REQUEST_TABLE_BOOKING,
        datos: { date: '2026-10-08', time: '9pm' },
      });

      await update.onMessage('Quiero una mesa', mockCtx);

      expect(restaurantReservationService.requestTable).not.toHaveBeenCalled();
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('para cuántas personas'),
        { parse_mode: 'HTML' },
      );
    });
  });

  describe('cancelación pedida por el huésped (CANCEL_RESERVATION)', () => {
    const reservationId = '5b0f7f8e-6c53-4d3f-9a7c-1f6f1d0f0002';

    it('cancela por el módulo de cancelación y responde con el texto fijo del backend (CA2, CA3)', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.CANCEL_RESERVATION,
        datos: { reservationId },
      });
      cancellationService.cancelForGuest.mockResolvedValue({
        ok: true,
        reply: 'Listo, cancelé tu reserva',
      });

      await update.onMessage('Sí, cancelala', mockCtx);

      expect(cancellationService.cancelForGuest).toHaveBeenCalledWith(
        mockTelegramUserId,
        reservationId,
      );
      expect(mockCtx.reply).toHaveBeenCalledWith('Listo, cancelé tu reserva', {
        parse_mode: 'HTML',
      });
    });

    it('le explica el motivo si no se puede cancelar', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.CANCEL_RESERVATION,
        datos: { reservationId },
      });
      cancellationService.cancelForGuest.mockResolvedValue({
        ok: false,
        reason: 'Esa reserva ya no se puede cancelar.',
      });

      await update.onMessage('Cancelala', mockCtx);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        'Esa reserva ya no se puede cancelar.',
        { parse_mode: 'HTML' },
      );
    });

    it('no cancela nada y pide aclarar si el id que manda el modelo no es válido', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.CANCEL_RESERVATION,
        datos: { reservationId: 'la-de-diciembre' },
      });

      await update.onMessage('Cancelá la de diciembre', mockCtx);

      expect(cancellationService.cancelForGuest).not.toHaveBeenCalled();
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('cuál de tus reservas'),
        { parse_mode: 'HTML' },
      );
    });
  });

  describe('confirmación sin nada para confirmar y link de pago', () => {
    const PENDING_LINK_REPLY =
      'Reserva del 30-10-2026 al 04-11-2026: seña de <b>$18000</b>.\nAboná acá: link';

    it('con opciones de fechas sin elegir no reserva ni repite el texto del modelo', async () => {
      jest.spyOn(bookingProcessService, 'getActive').mockResolvedValue({
        telegramUserId: mockTelegramUserId,
        step: BookingProcessStep.IN_PROGRESS,
        checkIn: '30-10-2026',
        checkOut: '04-11-2026',
        capacity: 2,
      } as any);
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.CONFIRM_RESERVATION,
        datos: { fullName: 'Patricia', dni: '34908567' },
        texto: '¡Perfecto, Patricia! Ya registré tus datos.',
      });

      await update.onMessage('Patricia 34908567', mockCtx);

      expect(reservationService.confirmReservation).not.toHaveBeenCalled();
      const [reply] = mockCtx.reply.mock.calls[0];
      expect(reply).toContain('cuál de las opciones');
      expect(reply).not.toContain('Ya registré tus datos');
    });

    it('si la reserva ya se tomó, reenvía el link de pago en vez de inventar una confirmación', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.CONFIRM_RESERVATION,
        datos: { fullName: 'Patricia', dni: '34908567' },
        texto: '¡Perfecto, Patricia! Ya registré tus datos.',
      });
      jest
        .spyOn(reservationService, 'buildPendingPaymentReply')
        .mockResolvedValue(PENDING_LINK_REPLY);

      await update.onMessage('Patricia 34908567', mockCtx);

      expect(reservationService.confirmReservation).not.toHaveBeenCalled();
      expect(mockCtx.reply).toHaveBeenCalledWith(PENDING_LINK_REPLY, {
        parse_mode: 'HTML',
      });
    });

    it('sin búsqueda ni reserva pendiente pide las fechas', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.CONFIRM_RESERVATION,
        datos: { fullName: 'Patricia', dni: '34908567' },
        texto: 'Listo, reservado',
      });

      await update.onMessage('Patricia 34908567', mockCtx);

      const [reply] = mockCtx.reply.mock.calls[0];
      expect(reply).toContain('fechas de entrada y salida');
      expect(reply).not.toContain('Listo, reservado');
    });

    it('le avisa al modelo si hay una reserva esperando el pago', async () => {
      jest
        .spyOn(reservationService, 'hasPendingPayment')
        .mockResolvedValue(true);
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.REPLY,
        texto: 'Hola',
      });

      await update.onMessage('Hola', mockCtx);

      expect(ragService.askQuestion).toHaveBeenCalledWith(
        'Hola',
        null,
        [],
        null,
        '[SERVICIOS DEL HOTEL]',
        expect.anything(),
        true,
        expect.anything(),
        expect.anything(),
      );
    });

    it('SEND_PAYMENT_LINK responde con el link que arma el backend', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.SEND_PAYMENT_LINK,
        datos: {},
      });
      jest
        .spyOn(reservationService, 'buildPendingPaymentReply')
        .mockResolvedValue(PENDING_LINK_REPLY);

      await update.onMessage('¿a dónde debo abonar la seña?', mockCtx);

      expect(mockCtx.reply).toHaveBeenCalledWith(PENDING_LINK_REPLY, {
        parse_mode: 'HTML',
      });
    });

    it('SEND_PAYMENT_LINK sin reservas esperando el pago no inventa un link', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.SEND_PAYMENT_LINK,
        datos: {},
      });

      await update.onMessage('pasame el link', mockCtx);

      const [reply] = mockCtx.reply.mock.calls[0];
      expect(reply).toContain('No tenés ninguna reserva esperando el pago');
    });
  });

  describe('cuenta para la devolución (REGISTER_REFUND_ACCOUNT)', () => {
    const reservationId = '5b0f7f8e-6c53-4d3f-9a7c-1f6f1d0f0003';

    it('guarda la cuenta por el módulo de cancelación y responde con su texto', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.REGISTER_REFUND_ACCOUNT,
        datos: {
          reservationId,
          alias: 'ana.perez.mp',
          holderName: 'Ana Pérez',
        },
      });
      cancellationService.registerRefundAccountForGuest.mockResolvedValue({
        ok: true,
        reply: 'Listo, anoté la cuenta',
      });

      await update.onMessage('ana.perez.mp, Ana Pérez', mockCtx);

      expect(
        cancellationService.registerRefundAccountForGuest,
      ).toHaveBeenCalledWith(
        mockTelegramUserId,
        reservationId,
        'ana.perez.mp',
        'Ana Pérez',
      );
      expect(mockCtx.reply).toHaveBeenCalledWith('Listo, anoté la cuenta', {
        parse_mode: 'HTML',
      });
    });

    it('le explica el motivo si los datos no sirven', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.REGISTER_REFUND_ACCOUNT,
        datos: { reservationId, alias: 'x', holderName: 'Ana Pérez' },
      });
      cancellationService.registerRefundAccountForGuest.mockResolvedValue({
        ok: false,
        reason: 'Ese alias no parece válido',
      });

      await update.onMessage('x', mockCtx);

      expect(mockCtx.reply).toHaveBeenCalledWith('Ese alias no parece válido', {
        parse_mode: 'HTML',
      });
    });

    it('no guarda nada si el id que manda el modelo no es válido', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.REGISTER_REFUND_ACCOUNT,
        datos: { reservationId: 'la-ultima', alias: 'ana.perez.mp' },
      });

      await update.onMessage('ana.perez.mp', mockCtx);

      expect(
        cancellationService.registerRefundAccountForGuest,
      ).not.toHaveBeenCalled();
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('de qué reserva es la devolución'),
        { parse_mode: 'HTML' },
      );
    });
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

    it('vuelve a pedir nombre y DNI si el DNI viene mal formado', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.REQUEST_SPA_BOOKING,
        datos: { ...datos, fullName: 'Beto Externo', dni: '28.111.222' },
      });

      await update.onMessage('Quiero un masaje', mockCtx);

      expect(spaReservationService.requestSpa).not.toHaveBeenCalled();
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('nombre completo y tu DNI'),
        { parse_mode: 'HTML' },
      );
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

  describe('room service (US-24)', () => {
    const ORDER_ID = '3c9a3c55-2b1f-4f5e-9d38-6c7a2f1b0a11';
    const datos = {
      items: [
        {
          menuItemId: '5d3f6a4e-8c2b-4b7a-9e1f-0a2b3c4d5e6f',
          quantity: 2,
          notes: 'sin sal',
        },
      ],
    };

    const buttonCtx = (data: string) => ({
      ...mockCtx,
      callbackQuery: { data },
      answerCbQuery: jest.fn().mockResolvedValue(true),
      editMessageReplyMarkup: jest.fn().mockResolvedValue(true),
    });

    it('le pasa a Chamber el contexto de room service', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.REPLY,
        texto: 'Hola',
      });

      await update.onMessage('Hola', mockCtx);

      expect(roomServiceService.getChatContext).toHaveBeenCalledWith(
        mockTelegramUserId,
      );
      expect(ragService.askQuestion).toHaveBeenCalledWith(
        'Hola',
        null,
        [],
        null,
        '[SERVICIOS DEL HOTEL]',
        expect.anything(),
        false,
        expect.anything(),
        { block: '[ROOM SERVICE]', canOrder: true, hasOpenOrder: false },
      );
    });

    it('arma el resumen y lo manda con los botones para confirmar (CA4)', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.PREPARE_ROOM_SERVICE_ORDER,
        datos,
      });
      roomServiceService.prepareOrder.mockResolvedValue({
        ok: true,
        orderId: ORDER_ID,
        reply: 'Tu pedido de room service',
      });

      await update.onMessage('Quiero 2 hamburguesas sin sal', mockCtx);

      expect(roomServiceService.prepareOrder).toHaveBeenCalledWith(
        mockTelegramUserId,
        expect.objectContaining({
          items: [expect.objectContaining(datos.items[0])],
        }),
      );
      expect(mockCtx.reply).toHaveBeenCalledWith('Tu pedido de room service', {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              expect.objectContaining({
                text: 'Confirmar pedido',
                callback_data: `roomservice:confirm:${ORDER_ID}`,
              }),
              expect.objectContaining({
                text: 'No, gracias',
                callback_data: `roomservice:discard:${ORDER_ID}`,
              }),
            ],
          ],
        },
      });
    });

    it('si el backend rechaza el pedido responde el motivo sin botones', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.PREPARE_ROOM_SERVICE_ORDER,
        datos,
      });
      roomServiceService.prepareOrder.mockResolvedValue({
        ok: false,
        reason: 'En este momento el room service está cerrado.',
      });

      await update.onMessage('Quiero una hamburguesa', mockCtx);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        'En este momento el room service está cerrado.',
        { parse_mode: 'HTML' },
      );
    });

    it('pide los platos si los argumentos del modelo son inválidos', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.PREPARE_ROOM_SERVICE_ORDER,
        datos: { items: [{ menuItemId: 'hamburguesa', quantity: 0 }] },
      });

      await update.onMessage('Quiero algo', mockCtx);

      expect(roomServiceService.prepareOrder).not.toHaveBeenCalled();
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('qué platos querés'),
        { parse_mode: 'HTML' },
      );
    });

    it('para cancelar pregunta con botones (CA8)', async () => {
      jest.spyOn(ragService, 'askQuestion').mockResolvedValue({
        action: ChatAction.CANCEL_ROOM_SERVICE_ORDER,
      });
      roomServiceService.requestCancel.mockResolvedValue({
        ok: true,
        orderId: ORDER_ID,
        reply: '¿Seguro que querés cancelar?',
      });

      await update.onMessage('Cancelá mi pedido', mockCtx);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        '¿Seguro que querés cancelar?',
        expect.objectContaining({
          reply_markup: {
            inline_keyboard: [
              [
                expect.objectContaining({
                  callback_data: `roomservice:cancel:${ORDER_ID}`,
                }),
                expect.objectContaining({
                  callback_data: `roomservice:keep:${ORDER_ID}`,
                }),
              ],
            ],
          },
        }),
      );
    });

    it('el botón "Confirmar pedido" confirma, saca los botones y deja todo en el chat', async () => {
      const ctx = buttonCtx(`roomservice:confirm:${ORDER_ID}`);
      roomServiceService.confirmOrder.mockResolvedValue({
        ok: true,
        orderId: ORDER_ID,
        reply: '¡Listo! Recibimos tu pedido',
      });

      await update.onRoomServiceAction(ctx);

      expect(ctx.answerCbQuery).toHaveBeenCalled();
      expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith(undefined);
      expect(roomServiceService.confirmOrder).toHaveBeenCalledWith(
        mockTelegramUserId,
        ORDER_ID,
      );
      expect(chatService.recordIncomingMessage).toHaveBeenCalledWith(
        session,
        'Confirmar pedido',
      );
      expect(chatService.recordBotMessage).toHaveBeenCalledWith(
        session,
        '¡Listo! Recibimos tu pedido',
      );
      expect(ctx.reply).toHaveBeenCalledWith('¡Listo! Recibimos tu pedido', {
        parse_mode: 'HTML',
      });
    });

    it.each([
      ['discard', 'discardDraft'],
      ['cancel', 'cancelOrder'],
    ] as const)(
      'el botón %s llama a %s del service',
      async (button, method) => {
        const ctx = buttonCtx(`roomservice:${button}:${ORDER_ID}`);
        roomServiceService[method].mockResolvedValue({
          ok: true,
          reply: 'Listo',
        });

        await update.onRoomServiceAction(ctx);

        expect(roomServiceService[method]).toHaveBeenCalledWith(
          mockTelegramUserId,
          ORDER_ID,
        );
        expect(ctx.reply).toHaveBeenCalledWith('Listo', { parse_mode: 'HTML' });
      },
    );

    it('"No, mantenerlo" no toca el pedido', async () => {
      const ctx = buttonCtx(`roomservice:keep:${ORDER_ID}`);

      await update.onRoomServiceAction(ctx);

      expect(roomServiceService.cancelOrder).not.toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(
        'Perfecto, tu pedido sigue en curso.',
        { parse_mode: 'HTML' },
      );
    });

    it('si el backend rechaza el botón responde el motivo escapado', async () => {
      const ctx = buttonCtx(`roomservice:confirm:${ORDER_ID}`);
      roomServiceService.confirmOrder.mockResolvedValue({
        ok: false,
        reason: 'Ese pedido ya estaba confirmado.',
      });

      await update.onRoomServiceAction(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        'Ese pedido ya estaba confirmado.',
        { parse_mode: 'HTML' },
      );
    });
  });
});
