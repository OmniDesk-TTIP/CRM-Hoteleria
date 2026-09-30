import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { RoomCategory } from '../../infrastructure/database/entities/RoomCategory.entity';
import { Room, RoomStatus } from '../../infrastructure/database/entities/Room.entity';

interface CategorySeed {
  name: string;
  capacity: number;
  basePrice: number;
  roomNumbers: string[];
}

const DEFAULT_CATEGORIES: CategorySeed[] = [
  { name: 'Individual', capacity: 1, basePrice: 8000, roomNumbers: ['101', '102'] },
  { name: 'Doble', capacity: 2, basePrice: 12000, roomNumbers: ['201', '202', '203'] },
  { name: 'Suite', capacity: 4, basePrice: 20000, roomNumbers: ['301', '302'] },
];

@Injectable()
export class RoomSeederService implements OnModuleInit {
  private readonly logger = new Logger(RoomSeederService.name);

  constructor(private readonly em: EntityManager) {}

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;

    const count = await this.em.count(Room);

    if (count === 0) {
      this.logger.log('No hay habitaciones cargadas. Sembrando habitaciones por defecto...');
      await this.seedDefaultRooms();
      this.logger.log('Habitaciones por defecto sembradas exitosamente.');
    } else {
      this.logger.log(`Ya existen ${count} habitaciones cargadas.`);
    }
  }

  private async seedDefaultRooms() {
    for (const { name, capacity, basePrice, roomNumbers } of DEFAULT_CATEGORIES) {
      const category = this.em.create(RoomCategory, { name, capacity, basePrice });

      for (const roomNumber of roomNumbers) {
        this.em.create(Room, { roomNumber, category, status: RoomStatus.ACTIVE });
      }
    }

    await this.em.flush();
  }
}
