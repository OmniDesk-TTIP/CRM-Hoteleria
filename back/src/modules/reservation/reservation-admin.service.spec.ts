import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ReservationAdminService } from './reservation-admin.service';
import { ReservationRepository } from './reservation.repository';
import { RoomRepository } from '../room/room.repository';
import { ReservationStatus } from '../../infrastructure/database/entities/Reservation.entity';
import { SaveReservationDto } from './dto/saveReservation.dto';
import { ListReservationsQueryDto } from './dto/listReservations.dto';

describe('ReservationAdminService', () => {
  let service: ReservationAdminService;
  let reservationRepository: ReservationRepository;
  let roomRepository: RoomRepository;

  const mockRoom: any = { id: 'room-1', roomNumber: '101', category: { id: 'cat-1', name: 'Doble' } };

  const buildPayload = (overrides: Partial<SaveReservationDto> = {}): SaveReservationDto => ({
    guestFullName: 'Juan Pérez',
    guestDni: '30111222',
    roomId: 'room-1',
    checkIn: '2026-10-10',
    checkOut: '2026-10-15',
    status: ReservationStatus.PENDING_PAYMENT,
    totalAmount: 500,
    depositAmount: 150,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationAdminService,
        {
          provide: ReservationRepository,
          useValue: {
            findManyPaginated: jest.fn(),
            findById: jest.fn(),
            isRoomOccupied: jest.fn(),
            createManual: jest.fn(),
            saveNew: jest.fn(),
            applyUpdate: jest.fn(),
            cancel: jest.fn(),
          },
        },
        {
          provide: RoomRepository,
          useValue: {
            findById: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ReservationAdminService>(ReservationAdminService);
    reservationRepository = module.get<ReservationRepository>(ReservationRepository);
    roomRepository = module.get<RoomRepository>(RoomRepository);
  });

  describe('list', () => {
    it('mapea los filtros de la query y devuelve el paginado con los DTO de cada reserva (CA1)', async () => {
      const reservation: any = {
        id: 'res-1',
        guestFullName: 'Juan Pérez',
        guestDni: '30111222',
        checkIn: new Date('2026-10-10'),
        checkOut: new Date('2026-10-15'),
        status: ReservationStatus.CONFIRMED,
        origin: 'MANUAL',
        totalAmount: 500,
        depositAmount: 150,
        room: mockRoom,
        createdAt: new Date('2026-09-01'),
      };

      jest.spyOn(reservationRepository, 'findManyPaginated').mockResolvedValue({ items: [reservation], total: 1 });

      const query: ListReservationsQueryDto = {
        status: ReservationStatus.CONFIRMED,
        dateFrom: '2026-10-01',
        dateTo: '2026-10-31',
        page: 1,
        pageSize: 10,
        sortBy: 'checkIn',
        sortDir: 'asc',
      };

      const result = await service.list(query);

      expect(reservationRepository.findManyPaginated).toHaveBeenCalledWith({
        status: ReservationStatus.CONFIRMED,
        dateFrom: new Date('2026-10-01'),
        dateTo: new Date('2026-10-31'),
        page: 1,
        pageSize: 10,
        sortBy: 'checkIn',
        sortDir: 'asc',
      });
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.data[0]).toMatchObject({
        id: 'res-1',
        room: { id: 'room-1', roomNumber: '101', categoryName: 'Doble' },
      });
    });
  });

  describe('create', () => {
    it('crea la reserva cuando la habitación está libre en esas fechas (CA2)', async () => {
      jest.spyOn(roomRepository, 'findById').mockResolvedValue(mockRoom);
      jest.spyOn(reservationRepository, 'isRoomOccupied').mockResolvedValue(false);
      jest.spyOn(reservationRepository, 'createManual').mockImplementation(
        (data: any) => ({ ...data, id: 'res-nueva' } as any),
      );

      const result = await service.create(buildPayload());

      expect(roomRepository.findById).toHaveBeenCalledWith('room-1');
      expect(reservationRepository.isRoomOccupied).toHaveBeenCalledWith(
        'room-1',
        new Date('2026-10-10'),
        new Date('2026-10-15'),
        undefined,
      );
      expect(reservationRepository.createManual).toHaveBeenCalledWith(
        expect.objectContaining({ room: mockRoom, guestFullName: 'Juan Pérez' }),
      );
      expect(reservationRepository.saveNew).toHaveBeenCalled();
      expect(result.id).toBe('res-nueva');
    });

    it('rechaza con 409 si la habitación ya está ocupada para esas fechas (CA3)', async () => {
      jest.spyOn(roomRepository, 'findById').mockResolvedValue(mockRoom);
      jest.spyOn(reservationRepository, 'isRoomOccupied').mockResolvedValue(true);

      await expect(service.create(buildPayload())).rejects.toThrow(ConflictException);
      expect(reservationRepository.createManual).not.toHaveBeenCalled();
      expect(reservationRepository.saveNew).not.toHaveBeenCalled();
    });

    it('rechaza con 404 si la habitación no existe', async () => {
      jest.spyOn(roomRepository, 'findById').mockResolvedValue(null);

      await expect(service.create(buildPayload())).rejects.toThrow(NotFoundException);
      expect(reservationRepository.isRoomOccupied).not.toHaveBeenCalled();
    });

    it('rechaza con 400 si el check-out no es posterior al check-in', async () => {
      await expect(
        service.create(buildPayload({ checkIn: '2026-10-15', checkOut: '2026-10-10' })),
      ).rejects.toThrow(BadRequestException);
      expect(roomRepository.findById).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('actualiza la reserva excluyéndose a sí misma del chequeo de disponibilidad (CA3)', async () => {
      const existing: any = { id: 'res-1', room: mockRoom };
      jest.spyOn(reservationRepository, 'findById').mockResolvedValue(existing);
      jest.spyOn(roomRepository, 'findById').mockResolvedValue(mockRoom);
      jest.spyOn(reservationRepository, 'isRoomOccupied').mockResolvedValue(false);

      await service.update('res-1', buildPayload({ status: ReservationStatus.CONFIRMED }));

      expect(reservationRepository.isRoomOccupied).toHaveBeenCalledWith(
        'room-1',
        new Date('2026-10-10'),
        new Date('2026-10-15'),
        'res-1',
      );
      expect(reservationRepository.applyUpdate).toHaveBeenCalledWith(
        existing,
        expect.objectContaining({ status: ReservationStatus.CONFIRMED }),
      );
    });

    it('rechaza con 404 si la reserva a editar no existe', async () => {
      jest.spyOn(reservationRepository, 'findById').mockResolvedValue(null);

      await expect(service.update('no-existe', buildPayload())).rejects.toThrow(NotFoundException);
      expect(reservationRepository.applyUpdate).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('cancela la reserva cuando existe y no estaba cancelada (CA5)', async () => {
      jest.spyOn(reservationRepository, 'cancel').mockResolvedValue(true);

      await service.cancel('res-1');

      expect(reservationRepository.cancel).toHaveBeenCalledWith('res-1');
      expect(reservationRepository.findById).not.toHaveBeenCalled();
    });

    it('es idempotente: si ya estaba cancelada no rompe (una doble confirmación no debe fallar)', async () => {
      jest.spyOn(reservationRepository, 'cancel').mockResolvedValue(false);
      jest.spyOn(reservationRepository, 'findById').mockResolvedValue({ id: 'res-1' } as any);

      await expect(service.cancel('res-1')).resolves.toBeUndefined();
    });

    it('rechaza con 404 si la reserva no existe', async () => {
      jest.spyOn(reservationRepository, 'cancel').mockResolvedValue(false);
      jest.spyOn(reservationRepository, 'findById').mockResolvedValue(null);

      await expect(service.cancel('no-existe')).rejects.toThrow(NotFoundException);
    });
  });
});
