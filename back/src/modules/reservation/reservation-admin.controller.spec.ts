import { Test, TestingModule } from '@nestjs/testing';
import { ReservationAdminController } from './reservation-admin.controller';
import { ReservationAdminService } from './reservation-admin.service';
import { ReservationStatus } from '../../infrastructure/database/entities/Reservation.entity';
import { SaveReservationDto } from './dto/saveReservation.dto';

describe('ReservationAdminController', () => {
  let controller: ReservationAdminController;
  let service: ReservationAdminService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReservationAdminController],
      providers: [
        {
          provide: ReservationAdminService,
          useValue: {
            list: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            cancel: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ReservationAdminController>(ReservationAdminController);
    service = module.get<ReservationAdminService>(ReservationAdminService);
  });

  it('GET / delega en reservationAdminService.list con la query', () => {
    const query: any = { page: 1, pageSize: 10, sortBy: 'checkIn', sortDir: 'desc' };
    controller.list(query);
    expect(service.list).toHaveBeenCalledWith(query);
  });

  it('POST / delega en reservationAdminService.create con el body', () => {
    const body: SaveReservationDto = {
      guestFullName: 'Juan Pérez',
      guestDni: '30111222',
      roomId: 'room-1',
      checkIn: '2026-10-10',
      checkOut: '2026-10-15',
      status: ReservationStatus.PENDING_PAYMENT,
      totalAmount: 500,
      depositAmount: 150,
    };

    controller.create(body);
    expect(service.create).toHaveBeenCalledWith(body);
  });

  it('PATCH /:id delega en reservationAdminService.update con el id y el body', () => {
    const body = { guestFullName: 'Editado' } as SaveReservationDto;
    controller.update('res-1', body);
    expect(service.update).toHaveBeenCalledWith('res-1', body);
  });

  it('DELETE /:id delega en reservationAdminService.cancel con el id', async () => {
    await controller.cancel('res-1');
    expect(service.cancel).toHaveBeenCalledWith('res-1');
  });
});
