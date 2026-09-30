import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/core';
import { RoomRepository } from './room.repository';
import { Room, RoomStatus } from '../../infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../../infrastructure/database/entities/RoomCategory.entity';

describe('RoomRepository', () => {
  let repository: RoomRepository;
  let em: EntityManager;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomRepository,
        {
          provide: EntityManager,
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            persist: jest.fn(),
            flush: jest.fn(),
            nativeUpdate: jest.fn(),
          },
        },
      ],
    }).compile();

    repository = module.get<RoomRepository>(RoomRepository);
    em = module.get<EntityManager>(EntityManager);
  });

  describe('findByCapacityExcluding', () => {
    it('solo busca habitaciones ACTIVE, para que Chamber nunca ofrezca una deshabilitada (CA4)', async () => {
      jest.spyOn(em, 'find').mockResolvedValue([]);

      await repository.findByCapacityExcluding(2, []);

      expect(em.find).toHaveBeenCalledWith(
        Room,
        expect.objectContaining({ status: RoomStatus.ACTIVE }),
        { populate: ['category'] },
      );
    });

    it('excluye los ids pasados además del filtro de estado', async () => {
      jest.spyOn(em, 'find').mockResolvedValue([]);

      await repository.findByCapacityExcluding(2, ['room-1']);

      expect(em.find).toHaveBeenCalledWith(
        Room,
        expect.objectContaining({ status: RoomStatus.ACTIVE, id: { $nin: ['room-1'] } }),
        { populate: ['category'] },
      );
    });
  });

  describe('findByRoomNumber', () => {
    it('busca por número exacto', async () => {
      jest.spyOn(em, 'findOne').mockResolvedValue(null);

      await repository.findByRoomNumber('201');

      expect(em.findOne).toHaveBeenCalledWith(Room, { roomNumber: '201' });
    });

    it('excluye la propia habitación cuando se pasa excludeRoomId (edición)', async () => {
      jest.spyOn(em, 'findOne').mockResolvedValue(null);

      await repository.findByRoomNumber('201', 'room-1');

      expect(em.findOne).toHaveBeenCalledWith(Room, { roomNumber: '201', id: { $ne: 'room-1' } });
    });
  });

  describe('findCategoryByName', () => {
    it('busca la categoría de forma case-insensitive', async () => {
      jest.spyOn(em, 'findOne').mockResolvedValue(null);

      await repository.findCategoryByName('doble');

      expect(em.findOne).toHaveBeenCalledWith(RoomCategory, { name: { $ilike: 'doble' } });
    });
  });

  describe('deactivate', () => {
    it('actualiza el status a INACTIVE solo si no lo estaba ya (CA3)', async () => {
      jest.spyOn(em, 'nativeUpdate').mockResolvedValue(1);

      const result = await repository.deactivate('room-1');

      expect(em.nativeUpdate).toHaveBeenCalledWith(
        Room,
        { id: 'room-1', status: { $ne: RoomStatus.INACTIVE } },
        { status: RoomStatus.INACTIVE },
      );
      expect(result).toBe(true);
    });

    it('devuelve false (idempotente) si no había fila para actualizar', async () => {
      jest.spyOn(em, 'nativeUpdate').mockResolvedValue(0);

      const result = await repository.deactivate('room-1');

      expect(result).toBe(false);
    });
  });
});
