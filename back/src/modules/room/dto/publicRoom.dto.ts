import { RoomCategory } from '../../../infrastructure/database/entities/RoomCategory.entity';
import { RoomCategoryPhoto } from '../../../infrastructure/database/entities/RoomCategoryPhoto.entity';
import { roomPhotoPath } from './roomPhoto.dto';

/**
 * Tipo de habitación tal como se muestra en la web del hotel (`GET /public/rooms`). Capacidad y
 * precio viven en el tipo, así que la landing ve "Doble" una vez y no cada habitación física.
 */
export class PublicRoomDto {
  id: string;
  name: string;
  capacity: number;
  pricePerNight: number;
  /** En el orden que eligió el admin: la primera es la portada. */
  photos: { id: string; url: string }[];

  static fromEntity(
    category: RoomCategory,
    photos: RoomCategoryPhoto[],
  ): PublicRoomDto {
    const dto = new PublicRoomDto();
    dto.id = category.id;
    dto.name = category.name;
    dto.capacity = category.capacity;
    dto.pricePerNight = Number(category.basePrice);
    dto.photos = photos.map((photo) => ({
      id: photo.id,
      url: roomPhotoPath(photo.id),
    }));
    return dto;
  }
}
