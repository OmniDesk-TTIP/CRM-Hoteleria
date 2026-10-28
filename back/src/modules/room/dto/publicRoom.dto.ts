import { RoomCategory } from '../../../infrastructure/database/entities/RoomCategory.entity';

/**
 * Tipo de habitación tal como se muestra en la web del hotel (`GET /public/rooms`). Capacidad y
 * precio viven en el tipo, así que la landing ve "Doble" una vez y no cada habitación física.
 */
export class PublicRoomDto {
  id: string;
  name: string;
  capacity: number;
  pricePerNight: number;

  static fromEntity(category: RoomCategory): PublicRoomDto {
    const dto = new PublicRoomDto();
    dto.id = category.id;
    dto.name = category.name;
    dto.capacity = category.capacity;
    dto.pricePerNight = Number(category.basePrice);
    return dto;
  }
}
