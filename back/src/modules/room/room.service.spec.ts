import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { RoomService } from './room.service';
import { RoomRepository } from './room.repository';
import { RoomStatus } from '../../infrastructure/database/entities/Room.entity';
import { CreateRoomDto } from './dto/createRoom.dto';
import { UpdateRoomDto } from './dto/updateRoom.dto';

describe('RoomService', () => {
  let service: RoomService;
  let roomRepository: RoomRepository;

  const mockCategory: any = { id: 'cat-1', name: 'Doble', capacity: 2, basePrice: 12000 };
  const mockRoom: any = { id: 'room-1', roomNumber: '201', status: RoomStatus.ACTIVE, category: mockCategory };

  const buildCreatePayload = (overrides: Partial<CreateRoomDto> = {}): CreateRoomDto => ({
    roomNumber: '204',
    categoryName: 'Doble',
    capacity: 2,
    basePrice: 12000,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomService,
        {
          provide: RoomRepository,
          useValue: {
            findAllWithCategory: jest.fn(),
            findByRoomNumber: jest.fn(),
            findCategoryByName: jest.fn(),
            createCategory: jest.fn(),
            create: jest.fn(),
            saveNew: jest.fn(),
            save: jest.fn(),
            findById: jest.fn(),
            deactivate: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<RoomService>(RoomService);
    roomRepository = module.get<RoomRepository>(RoomRepository);
  });

  describe('list', () => {
    it('devuelve el inventario completo con precio, capacidad y estado (CA1)', async () => {
      jest.spyOn(roomRepository, 'findAllWithCategory').mockResolvedValue([mockRoom]);

      const result = await service.list();

      expect(result).toEqual([
        {
          id: 'room-1',
          roomNumber: '201',
          status: RoomStatus.ACTIVE,
          categoryId: 'cat-1',
          categoryName: 'Doble',
          capacity: 2,
          basePrice: 12000,
        },
      ]);
    });
  });

  describe('create', () => {
    it('rechaza con 409 si ya existe una habitación con ese número (CA2)', async () => {
      jest.spyOn(roomRepository, 'findByRoomNumber').mockResolvedValue(mockRoom);

      await expect(service.create(buildCreatePayload({ roomNumber: '201' }))).rejects.toThrow(ConflictException);
      expect(roomRepository.create).not.toHaveBeenCalled();
      expect(roomRepository.saveNew).not.toHaveBeenCalled();
    });

    it('reutiliza el tipo existente si ya hay una categoría con ese nombre (sin pisar su precio/capacidad)', async () => {
      jest.spyOn(roomRepository, 'findByRoomNumber').mockResolvedValue(null);
      jest.spyOn(roomRepository, 'findCategoryByName').mockResolvedValue(mockCategory);
      jest.spyOn(roomRepository, 'create').mockImplementation((data: any) => ({ ...data, id: 'room-nueva' }) as any);

      const result = await service.create(buildCreatePayload({ capacity: 99, basePrice: 999999 }));

      expect(roomRepository.createCategory).not.toHaveBeenCalled();
      expect(roomRepository.create).toHaveBeenCalledWith({
        roomNumber: '204',
        category: mockCategory,
        status: RoomStatus.ACTIVE,
      });
      expect(roomRepository.saveNew).toHaveBeenCalled();
      expect(result.id).toBe('room-nueva');
    });

    it('crea un tipo nuevo cuando no existe una categoría con ese nombre', async () => {
      const newCategory: any = { id: 'cat-2', name: 'Familiar', capacity: 5, basePrice: 25000 };
      jest.spyOn(roomRepository, 'findByRoomNumber').mockResolvedValue(null);
      jest.spyOn(roomRepository, 'findCategoryByName').mockResolvedValue(null);
      jest.spyOn(roomRepository, 'createCategory').mockReturnValue(newCategory);
      jest.spyOn(roomRepository, 'create').mockImplementation((data: any) => ({ ...data, id: 'room-nueva' }) as any);

      await service.create(buildCreatePayload({ categoryName: 'Familiar', capacity: 5, basePrice: 25000 }));

      expect(roomRepository.createCategory).toHaveBeenCalledWith({ name: 'Familiar', capacity: 5, basePrice: 25000 });
      expect(roomRepository.create).toHaveBeenCalledWith({
        roomNumber: '204',
        category: newCategory,
        status: RoomStatus.ACTIVE,
      });
    });

    it('crea la habitación como ACTIVE por defecto si no se especifica estado', async () => {
      jest.spyOn(roomRepository, 'findByRoomNumber').mockResolvedValue(null);
      jest.spyOn(roomRepository, 'findCategoryByName').mockResolvedValue(mockCategory);
      jest.spyOn(roomRepository, 'create').mockImplementation((data: any) => data as any);

      await service.create(buildCreatePayload());

      expect(roomRepository.create).toHaveBeenCalledWith(expect.objectContaining({ status: RoomStatus.ACTIVE }));
    });
  });

  describe('update', () => {
    const freshRoom = () => ({ id: 'room-1', roomNumber: '201', status: RoomStatus.ACTIVE, category: { ...mockCategory } });

    it('rechaza con 404 si la habitación no existe', async () => {
      jest.spyOn(roomRepository, 'findById').mockResolvedValue(null);

      await expect(service.update('no-existe', {} as UpdateRoomDto)).rejects.toThrow(NotFoundException);
    });

    it('rechaza con 409 si el nuevo número ya lo usa otra habitación (CA2)', async () => {
      const room = freshRoom();
      jest.spyOn(roomRepository, 'findById').mockResolvedValue(room as any);
      jest.spyOn(roomRepository, 'findByRoomNumber').mockResolvedValue({ id: 'otra-habitacion' } as any);

      await expect(service.update('room-1', { roomNumber: '999' })).rejects.toThrow(ConflictException);
      expect(roomRepository.findByRoomNumber).toHaveBeenCalledWith('999', 'room-1');
      expect(roomRepository.save).not.toHaveBeenCalled();
    });

    it('actualiza el precio base y la capacidad del tipo actual cuando no cambia de tipo (CA4)', async () => {
      const room = freshRoom();
      jest.spyOn(roomRepository, 'findById').mockResolvedValue(room as any);

      const result = await service.update('room-1', { basePrice: 15000, capacity: 3 });

      expect(room.category.basePrice).toBe(15000);
      expect(room.category.capacity).toBe(3);
      expect(roomRepository.save).toHaveBeenCalled();
      expect(result.basePrice).toBe(15000);
    });

    it('cambia de tipo reutilizando una categoría existente con ese nombre', async () => {
      const room = freshRoom();
      const suiteCategory: any = { id: 'cat-suite', name: 'Suite', capacity: 4, basePrice: 20000 };
      jest.spyOn(roomRepository, 'findById').mockResolvedValue(room as any);
      jest.spyOn(roomRepository, 'findCategoryByName').mockResolvedValue(suiteCategory);

      await service.update('room-1', { categoryName: 'Suite' });

      expect(roomRepository.createCategory).not.toHaveBeenCalled();
      expect(room.category).toBe(suiteCategory);
    });

    it('cambia el estado a INACTIVE cuando se lo piden explícitamente por PATCH', async () => {
      const room = freshRoom();
      jest.spyOn(roomRepository, 'findById').mockResolvedValue(room as any);

      const result = await service.update('room-1', { status: RoomStatus.INACTIVE });

      expect(result.status).toBe(RoomStatus.INACTIVE);
    });

    it('no toca el número de habitación si el nuevo valor es igual al actual', async () => {
      const room = freshRoom();
      jest.spyOn(roomRepository, 'findById').mockResolvedValue(room as any);

      await service.update('room-1', { roomNumber: '201' });

      expect(roomRepository.findByRoomNumber).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('desactiva la habitación (soft delete, CA3)', async () => {
      jest.spyOn(roomRepository, 'deactivate').mockResolvedValue(true);

      await service.remove('room-1');

      expect(roomRepository.deactivate).toHaveBeenCalledWith('room-1');
      expect(roomRepository.findById).not.toHaveBeenCalled();
    });

    it('es idempotente: si ya estaba inactiva no rompe', async () => {
      jest.spyOn(roomRepository, 'deactivate').mockResolvedValue(false);
      jest.spyOn(roomRepository, 'findById').mockResolvedValue(mockRoom);

      await expect(service.remove('room-1')).resolves.toBeUndefined();
    });

    it('rechaza con 404 si la habitación no existe', async () => {
      jest.spyOn(roomRepository, 'deactivate').mockResolvedValue(false);
      jest.spyOn(roomRepository, 'findById').mockResolvedValue(null);

      await expect(service.remove('no-existe')).rejects.toThrow(NotFoundException);
    });
  });
});
