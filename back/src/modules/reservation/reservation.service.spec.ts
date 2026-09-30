import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ReservationService } from './reservation.service';
import { BookingProcessService } from '../bookingProcess/bookingProcess.service';
import { RoomRepository } from '../room/room.repository';
import { ReservationRepository } from './reservation.repository';
import { PaymentService } from '../payment/payment.service';
import { BookingProcessStep } from '../../infrastructure/database/entities/BookingProcess.entity';

describe('ReservationService', () => {
  let service: ReservationService;
  let bookingProcessService: BookingProcessService;
  let roomRepository: RoomRepository;
  let reservationRepository: ReservationRepository;
  let paymentService: PaymentService;

  const mockTelegramUserId = '123456789';
  const mockGuestData = { fullName: 'Juan Pérez', dni: '30111222' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationService,
        {
          provide: BookingProcessService,
          useValue: {
            startSearch: jest.fn().mockImplementation((telegramUserId, activeBooking, dto) =>
              activeBooking || { telegramUserId, checkIn: dto.checkIn, checkOut: dto.checkOut, capacity: dto.capacity, step: BookingProcessStep.IN_PROGRESS }
            ),
            markPendingConfirmation: jest.fn(),
            markInProgress: jest.fn(),
            markCompleted: jest.fn(),
          },
        },
        {
          provide: RoomRepository,
          useValue: {
            findByCapacityExcluding: jest.fn(),
          },
        },
        {
          provide: ReservationRepository,
          useValue: {
            findOverlapping: jest.fn(),
            create: jest.fn().mockImplementation((data) => ({ ...data, id: 'reservation-1' })),
            persist: jest.fn(),
          },
        },
        {
          provide: PaymentService,
          useValue: {
            createPreference: jest.fn().mockResolvedValue({ preferenceId: 'pref-1', initPoint: 'https://mp.example/pref-1' }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => ({ FRONTEND_BASE_URL: 'http://localhost:5173' })[key]),
          },
        },
      ],
    }).compile();

    service = module.get<ReservationService>(ReservationService);
    bookingProcessService = module.get<BookingProcessService>(BookingProcessService);
    roomRepository = module.get<RoomRepository>(RoomRepository);
    reservationRepository = module.get<ReservationRepository>(ReservationRepository);
    paymentService = module.get<PaymentService>(PaymentService);
  });

  describe('searchAvailability', () => {
    const suite = { id: 'room-1', category: { name: 'Suite', basePrice: 100 } };
    const doble = { id: 'room-2', category: { name: 'Doble', basePrice: 80 } };
    const october = (day: number) => new Date(2026, 9, day);
    const reserved = (room: { id: string }, fromDay: number, toDay: number) =>
      ({ room, checkIn: october(fromDay), checkOut: october(toDay) });

    /** Simula la base: reservas activas y habitaciones que respetan los filtros de cada consulta. */
    const givenHotel = (rooms: any[], reservations: any[]) => {
      jest.spyOn(reservationRepository, 'findOverlapping').mockImplementation(async (checkIn, checkOut) =>
        reservations.filter((r) => r.checkIn < checkOut && r.checkOut > checkIn),
      );
      jest.spyOn(roomRepository, 'findByCapacityExcluding').mockImplementation(async (_capacity, excludedIds) =>
        rooms.filter((room) => !excludedIds.includes(room.id)),
      );
    };

    const search = (checkIn: string, checkOut: string) =>
      service.searchAvailability(mockTelegramUserId, null, { checkIn, checkOut, capacity: 2 });

    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(new Date(2026, 8, 1));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('devuelve la oferta de la habitación cuando hay disponibilidad', async () => {
      givenHotel([suite], []);

      const result = await search('10-10-2026', '15-10-2026');

      expect(result.available).toBe(true);
      const { reply } = result as { reply: string };
      expect(reply).toContain('Tenemos disponibilidad en nuestra Suite del 10-10-2026 al 15-10-2026 por $100 la noche.');
      expect(reply).toContain('El total de tu estadía (5 noches) sería de $500');
      expect(reply).toContain('seña del 30% de $150');
      expect(roomRepository.findByCapacityExcluding).toHaveBeenCalledWith(2, []);
      expect(bookingProcessService.markPendingConfirmation).toHaveBeenCalled();
      expect(bookingProcessService.markInProgress).not.toHaveBeenCalled();
    });

    it('marca el booking IN_PROGRESS y devuelve alternativas vacías si no hay habitaciones para esa capacidad', async () => {
      givenHotel([], []);

      const result = await search('10-10-2026', '15-10-2026');

      expect(result).toEqual({ available: false, alternatives: [] });
      expect(bookingProcessService.markInProgress).toHaveBeenCalled();
      expect(bookingProcessService.markPendingConfirmation).not.toHaveBeenCalled();
    });

    it('busca las alternativas con una sola consulta de reservas sobre la ventana de ±7 días', async () => {
      givenHotel([suite], [reserved(suite, 10, 15)]);

      await search('10-10-2026', '15-10-2026');

      expect(reservationRepository.findOverlapping).toHaveBeenCalledTimes(2);
      expect(reservationRepository.findOverlapping).toHaveBeenLastCalledWith(october(3), october(22));
    });

    it('ofrece estadías completas ordenadas por cercanía, con un tope de 3', async () => {
      givenHotel([suite], [reserved(suite, 10, 15)]);

      const result = await search('10-10-2026', '15-10-2026');

      expect(result).toEqual({
        available: false,
        alternatives: [
          { checkIn: '15-10-2026', checkOut: '20-10-2026', nights: 5, isShorterStay: false, roomCategory: 'Suite', totalAmount: 500 },
          { checkIn: '05-10-2026', checkOut: '10-10-2026', nights: 5, isShorterStay: false, roomCategory: 'Suite', totalAmount: 500 },
          { checkIn: '16-10-2026', checkOut: '21-10-2026', nights: 5, isShorterStay: false, roomCategory: 'Suite', totalAmount: 500 },
        ],
      });
    });

    it('prioriza una estadía más corta que se superpone con lo pedido antes que las completas corridas', async () => {
      givenHotel([suite], [reserved(suite, 9, 12)]);

      const result = await search('10-10-2026', '15-10-2026');

      expect(result).toEqual({
        available: false,
        alternatives: [
          { checkIn: '12-10-2026', checkOut: '16-10-2026', nights: 4, isShorterStay: true, roomCategory: 'Suite', totalAmount: 400 },
          { checkIn: '12-10-2026', checkOut: '17-10-2026', nights: 5, isShorterStay: false, roomCategory: 'Suite', totalAmount: 500 },
          { checkIn: '13-10-2026', checkOut: '18-10-2026', nights: 5, isShorterStay: false, roomCategory: 'Suite', totalAmount: 500 },
        ],
      });
    });

    it('completa con más estadías cortas cuando no hay suficientes completas', async () => {
      givenHotel(
        [suite, doble],
        [reserved(suite, 1, 11), reserved(suite, 15, 30), reserved(doble, 1, 10), reserved(doble, 13, 30)],
      );

      const result = await search('10-10-2026', '15-10-2026');

      expect(result).toEqual({
        available: false,
        alternatives: [
          { checkIn: '11-10-2026', checkOut: '15-10-2026', nights: 4, isShorterStay: true, roomCategory: 'Suite', totalAmount: 400 },
          { checkIn: '10-10-2026', checkOut: '13-10-2026', nights: 3, isShorterStay: true, roomCategory: 'Doble', totalAmount: 240 },
        ],
      });
    });

    it('no ofrece estadías por debajo de la mitad de las noches pedidas', async () => {
      // Pide 7 noches y solo quedan libres 2 (09 y 10): menos de la mitad, no se ofrecen.
      givenHotel([suite], [reserved(suite, 1, 9), reserved(suite, 11, 30)]);

      const result = await search('10-10-2026', '17-10-2026');

      expect(result).toEqual({ available: false, alternatives: [] });
    });

    it('descarta alternativas que empiezan antes de hoy', async () => {
      jest.setSystemTime(october(8));
      givenHotel([suite], [reserved(suite, 10, 15)]);

      const result = await search('10-10-2026', '15-10-2026');

      const checkIns = (result as { alternatives: { checkIn: string }[] }).alternatives.map((a) => a.checkIn);
      expect(checkIns).toEqual(['15-10-2026', '16-10-2026', '17-10-2026']);
    });

    it('toma bien los días de reservas guardadas a medianoche UTC', async () => {
      const utcMidnight = (day: number) => new Date(Date.UTC(2026, 9, day));
      givenHotel([suite], [{ room: suite, checkIn: utcMidnight(10), checkOut: utcMidnight(15) }]);
      jest.spyOn(reservationRepository, 'findOverlapping')
        .mockResolvedValueOnce([{ room: suite } as any])
        .mockResolvedValueOnce([{ room: suite, checkIn: utcMidnight(10), checkOut: utcMidnight(15) } as any]);

      const result = await search('10-10-2026', '15-10-2026');

      expect((result as { alternatives: { checkIn: string }[] }).alternatives[0].checkIn).toBe('15-10-2026');
    });
  });

  describe('confirmReservation', () => {
    const activeBooking: any = {
      telegramUserId: mockTelegramUserId,
      step: BookingProcessStep.PENDING_CONFIRMATION,
      checkIn: '10-10-2026',
      checkOut: '15-10-2026',
      capacity: 2,
    };

    it('crea la reserva y calcula el total cuando la habitación sigue disponible', async () => {
      const mockRoom = { id: 'room-1', category: { name: 'Suite', basePrice: 100 } };

      jest.spyOn(reservationRepository, 'findOverlapping').mockResolvedValue([]);
      jest.spyOn(roomRepository, 'findByCapacityExcluding').mockResolvedValue([mockRoom as any]);

      const booking = { ...activeBooking };
      const botReply = await service.confirmReservation(mockTelegramUserId, booking, mockGuestData);

      expect(botReply).toContain('Te estoy guardando la Suite del 10-10-2026 al 15-10-2026');
      expect(botReply).toContain('<b>Todavía no está confirmada.</b>');
      expect(botReply).toContain('Te guardo la habitación 30 minutos');
      expect(botReply).toContain('Total de la estadía: $500');
      expect(botReply).toContain('Seña para reservarla: $150');
      expect(botReply).toContain(
        '<a href="http://localhost:5173/payment/form/reservation-1">http://localhost:5173/payment/form/reservation-1</a>',
      );
      expect(reservationRepository.persist).toHaveBeenCalledWith(
        expect.objectContaining({
          totalAmount: 500,
          depositAmount: 150,
          room: mockRoom,
          guestFullName: 'Juan Pérez',
          guestDni: '30111222',
        })
      );
      expect(paymentService.createPreference).toHaveBeenCalledWith(
        expect.objectContaining({ guestFullName: 'Juan Pérez', guestDni: '30111222' }),
        mockGuestData,
      );
      expect(bookingProcessService.markCompleted).toHaveBeenCalledWith(booking);
    });

    it('propaga el error si Mercado Pago falla al crear la preferencia (no queda reserva a medio confirmar)', async () => {
      const mockRoom = { id: 'room-1', category: { name: 'Suite', basePrice: 100 } };

      jest.spyOn(reservationRepository, 'findOverlapping').mockResolvedValue([]);
      jest.spyOn(roomRepository, 'findByCapacityExcluding').mockResolvedValue([mockRoom as any]);
      jest.spyOn(paymentService, 'createPreference').mockRejectedValue(new Error('Mercado Pago no responde'));

      const booking = { ...activeBooking };

      await expect(service.confirmReservation(mockTelegramUserId, booking, mockGuestData)).rejects.toThrow(
        'Mercado Pago no responde',
      );
    });

    it('marca el booking como IN_PROGRESS si la habitación se ocupó mientras tanto', async () => {
      jest.spyOn(reservationRepository, 'findOverlapping').mockResolvedValue([]);
      jest.spyOn(roomRepository, 'findByCapacityExcluding').mockResolvedValue([]);
      const booking = { ...activeBooking };

      const botReply = await service.confirmReservation(mockTelegramUserId, booking, mockGuestData);

      expect(botReply).toContain('alguien acaba de reservar la última habitación disponible');
      expect(bookingProcessService.markInProgress).toHaveBeenCalledWith(booking);
      expect(reservationRepository.persist).not.toHaveBeenCalled();
      expect(paymentService.createPreference).not.toHaveBeenCalled();
    });
  });
});
