import { Test, TestingModule } from '@nestjs/testing';
import { BookingProcessService } from './bookingProcess.service';
import { BookingProcessRepository } from './bookingProcess.repository';
import { BookingProcessStep } from '../../infrastructure/database/entities/BookingProcess.entity';

describe('BookingProcessService', () => {
  let service: BookingProcessService;
  let repository: BookingProcessRepository;

  const mockTelegramUserId = '123456789';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingProcessService,
        {
          provide: BookingProcessRepository,
          useValue: {
            findActive: jest.fn(),
            findLastCompleted: jest.fn(),
            create: jest.fn().mockImplementation((telegramUserId: string) => ({ telegramUserId, step: BookingProcessStep.IN_PROGRESS })),
            persist: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<BookingProcessService>(BookingProcessService);
    repository = module.get<BookingProcessRepository>(BookingProcessRepository);
  });

  it('getActive delega en el repository', async () => {
    const booking: any = { telegramUserId: mockTelegramUserId };
    jest.spyOn(repository, 'findActive').mockResolvedValue(booking);

    await expect(service.getActive(mockTelegramUserId)).resolves.toBe(booking);
    expect(repository.findActive).toHaveBeenCalledWith(mockTelegramUserId);
  });

  it('getLastCompleted delega en el repository', async () => {
    const booking: any = { telegramUserId: mockTelegramUserId };
    jest.spyOn(repository, 'findLastCompleted').mockResolvedValue(booking);

    await expect(service.getLastCompleted(mockTelegramUserId)).resolves.toBe(booking);
    expect(repository.findLastCompleted).toHaveBeenCalledWith(mockTelegramUserId);
  });

  describe('startSearch', () => {
    it('crea un booking nuevo cuando no hay uno activo', () => {
      const booking = service.startSearch(mockTelegramUserId, null, { checkIn: '10-10-2026', checkOut: '15-10-2026', capacity: 2 });

      expect(repository.create).toHaveBeenCalledWith(mockTelegramUserId);
      expect(booking).toMatchObject({ checkIn: '10-10-2026', checkOut: '15-10-2026', capacity: 2 });
    });

    it('reutiliza el booking activo si ya existe', () => {
      const activeBooking: any = { telegramUserId: mockTelegramUserId, step: BookingProcessStep.IN_PROGRESS };

      const booking = service.startSearch(mockTelegramUserId, activeBooking, { checkIn: '10-10-2026', checkOut: '15-10-2026', capacity: 2 });

      expect(repository.create).not.toHaveBeenCalled();
      expect(booking).toBe(activeBooking);
      expect(booking).toMatchObject({ checkIn: '10-10-2026', checkOut: '15-10-2026', capacity: 2 });
    });
  });

  it('markPendingConfirmation cambia el step y persiste', () => {
    const booking: any = { step: BookingProcessStep.IN_PROGRESS };

    service.markPendingConfirmation(booking);

    expect(booking.step).toBe(BookingProcessStep.PENDING_CONFIRMATION);
    expect(repository.persist).toHaveBeenCalledWith(booking);
  });

  it('markInProgress cambia el step y persiste', () => {
    const booking: any = { step: BookingProcessStep.PENDING_CONFIRMATION };

    service.markInProgress(booking);

    expect(booking.step).toBe(BookingProcessStep.IN_PROGRESS);
    expect(repository.persist).toHaveBeenCalledWith(booking);
  });

  it('markCompleted cambia el step y persiste', () => {
    const booking: any = { step: BookingProcessStep.PENDING_CONFIRMATION };

    service.markCompleted(booking);

    expect(booking.step).toBe(BookingProcessStep.COMPLETED);
    expect(repository.persist).toHaveBeenCalledWith(booking);
  });
});
