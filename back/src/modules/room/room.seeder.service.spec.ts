import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/core';
import { RoomSeederService } from './room.seeder.service';
import { Room } from '../../infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../../infrastructure/database/entities/RoomCategory.entity';

describe('RoomSeederService', () => {
  let service: RoomSeederService;
  let em: EntityManager;
  let originalNodeEnv: string | undefined;

  beforeEach(async () => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'dev';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomSeederService,
        {
          provide: EntityManager,
          useValue: {
            count: jest.fn(),
            create: jest.fn(),
            flush: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<RoomSeederService>(RoomSeederService);
    em = module.get<EntityManager>(EntityManager);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('no hace nada en entorno de test', async () => {
    process.env.NODE_ENV = 'test';

    await service.onModuleInit();

    expect(em.count).not.toHaveBeenCalled();
  });

  it('siembra las categorías y habitaciones por defecto si no hay habitaciones cargadas', async () => {
    jest.spyOn(em, 'count').mockResolvedValue(0);
    jest.spyOn(em, 'create').mockImplementation((_entity, data) => data as any);

    await service.onModuleInit();

    expect(em.create).toHaveBeenCalledWith(RoomCategory, { name: 'Individual', capacity: 1, basePrice: 8000 });
    expect(em.create).toHaveBeenCalledWith(RoomCategory, { name: 'Doble', capacity: 2, basePrice: 12000 });
    expect(em.create).toHaveBeenCalledWith(RoomCategory, { name: 'Suite', capacity: 4, basePrice: 20000 });
    expect(em.create).toHaveBeenCalledWith(Room, expect.objectContaining({ roomNumber: '101' }));
    expect(em.flush).toHaveBeenCalled();
  });

  it('no siembra nada si ya existen habitaciones cargadas', async () => {
    jest.spyOn(em, 'count').mockResolvedValue(5);

    await service.onModuleInit();

    expect(em.create).not.toHaveBeenCalled();
    expect(em.flush).not.toHaveBeenCalled();
  });
});
