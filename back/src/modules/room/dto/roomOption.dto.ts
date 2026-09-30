import { Room, RoomStatus } from '../../../infrastructure/database/entities/Room.entity';

/** Respuesta de `GET /rooms`: espejo de `RoomOption` en el front. */
export class RoomOptionDto {
  id: string;
  roomNumber: string;
  status: RoomStatus;
  categoryId: string;
  categoryName: string;
  capacity: number;
  basePrice: number;

  static fromEntity(room: Room): RoomOptionDto {
    const dto = new RoomOptionDto();
    dto.id = room.id;
    dto.roomNumber = room.roomNumber;
    dto.status = room.status;
    dto.categoryId = room.category.id;
    dto.categoryName = room.category.name;
    dto.capacity = room.category.capacity;
    dto.basePrice = Number(room.category.basePrice);
    return dto;
  }
}
