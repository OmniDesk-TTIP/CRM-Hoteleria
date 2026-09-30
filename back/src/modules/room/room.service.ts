import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RoomRepository } from './room.repository';
import { Room, RoomStatus } from '../../infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../../infrastructure/database/entities/RoomCategory.entity';
import { CreateRoomDto } from './dto/createRoom.dto';
import { UpdateRoomDto } from './dto/updateRoom.dto';
import { RoomOptionDto } from './dto/roomOption.dto';

@Injectable()
export class RoomService {
  constructor(private readonly roomRepository: RoomRepository) {}

  async list(): Promise<RoomOptionDto[]> {
    const rooms = await this.roomRepository.findAllWithCategory();
    return rooms.map((room) => RoomOptionDto.fromEntity(room));
  }

  async create(payload: CreateRoomDto): Promise<RoomOptionDto> {
    const existing = await this.roomRepository.findByRoomNumber(payload.roomNumber);
    if (existing) {
      throw new ConflictException('Ya existe una habitación con ese número');
    }

    const category = await this.resolveCategory(payload.categoryName, payload.capacity, payload.basePrice);

    const room = this.roomRepository.create({
      roomNumber: payload.roomNumber,
      category,
      status: payload.status ?? RoomStatus.ACTIVE,
    });

    await this.roomRepository.saveNew(room);
    return RoomOptionDto.fromEntity(room);
  }

  async update(id: string, payload: UpdateRoomDto): Promise<RoomOptionDto> {
    const room = await this.roomRepository.findById(id);
    if (!room) {
      throw new NotFoundException('Habitación no encontrada');
    }

    if (payload.roomNumber && payload.roomNumber !== room.roomNumber) {
      const conflict = await this.roomRepository.findByRoomNumber(payload.roomNumber, id);
      if (conflict) {
        throw new ConflictException('Ya existe una habitación con ese número');
      }
      room.roomNumber = payload.roomNumber;
    }

    const changesType = payload.categoryName !== undefined && payload.categoryName.toLowerCase() !== room.category.name.toLowerCase();

    if (changesType) {
      room.category = await this.resolveCategory(
        payload.categoryName!,
        payload.capacity ?? room.category.capacity,
        payload.basePrice ?? room.category.basePrice,
      );
    } else {
      if (payload.capacity !== undefined) room.category.capacity = payload.capacity;
      if (payload.basePrice !== undefined) room.category.basePrice = payload.basePrice;
    }

    if (payload.status !== undefined) {
      room.status = payload.status;
    }

    await this.roomRepository.save();
    return RoomOptionDto.fromEntity(room);
  }

  async remove(id: string): Promise<void> {
    const deactivated = await this.roomRepository.deactivate(id);
    if (deactivated) return;

    const exists = await this.roomRepository.findById(id);
    if (!exists) throw new NotFoundException('Habitación no encontrada');
    //si existe pero no se pudo desactivar es porque ya estaba inactiva
  }

  private async resolveCategory(categoryName: string, capacity: number, basePrice: number): Promise<RoomCategory> {
    const existing = await this.roomRepository.findCategoryByName(categoryName);
    if (existing) return existing;

    return this.roomRepository.createCategory({ name: categoryName, capacity, basePrice });
  }
}
