import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { Room, RoomStatus } from '../../infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../../infrastructure/database/entities/RoomCategory.entity';

interface CreateRoomData {
  roomNumber: string;
  category: RoomCategory;
  status: RoomStatus;
}

interface CreateCategoryData {
  name: string;
  capacity: number;
  basePrice: number;
}

@Injectable()
export class RoomRepository {
  constructor(private readonly em: EntityManager) {}

  async findByCapacityExcluding(capacity: number, excludedRoomIds: string[]): Promise<Room[]> {
    return this.em.find(Room, {
      status: RoomStatus.ACTIVE,
      category: { capacity: { $gte: capacity } },
      ...(excludedRoomIds.length > 0 ? { id: { $nin: excludedRoomIds } } : {}),
    }, { populate: ['category'] });
  }

  async findById(id: string): Promise<Room | null> {
    return this.em.findOne(Room, { id }, { populate: ['category'] });
  }

  async findAllWithCategory(): Promise<Room[]> {
    return this.em.find(Room, {}, { populate: ['category'], orderBy: { roomNumber: 'asc' } });
  }

  async findByRoomNumber(roomNumber: string, excludeRoomId?: string): Promise<Room | null> {
    return this.em.findOne(Room, {
      roomNumber,
      ...(excludeRoomId ? { id: { $ne: excludeRoomId } } : {}),
    });
  }

  async findCategoryByName(name: string): Promise<RoomCategory | null> {
    return this.em.findOne(RoomCategory, { name: { $ilike: name } });
  }

  createCategory(data: CreateCategoryData): RoomCategory {
    return this.em.create(RoomCategory, data);
  }

  create(data: CreateRoomData): Room {
    return this.em.create(Room, data);
  }

  async saveNew(room: Room): Promise<void> {
    this.em.persist(room);
    await this.em.flush();
  }

  async save(): Promise<void> {
    await this.em.flush();
  }

  async deactivate(id: string): Promise<boolean> {
    const affected = await this.em.nativeUpdate(
      Room,
      { id, status: { $ne: RoomStatus.INACTIVE } },
      { status: RoomStatus.INACTIVE },
    );

    return affected === 1;
  }
}
