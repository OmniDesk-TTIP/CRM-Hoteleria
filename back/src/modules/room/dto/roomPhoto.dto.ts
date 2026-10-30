import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';
import { RoomCategoryPhoto } from '../../../infrastructure/database/entities/RoomCategoryPhoto.entity';

export const MAX_ROOM_PHOTOS = 10;

export const PUBLIC_ROOM_PHOTO_PATH = '/public/rooms/photos';

export const roomPhotoPath = (id: string) => `${PUBLIC_ROOM_PHOTO_PATH}/${id}`;

/** Foto de un tipo de habitación en el panel (`/rooms/categories/:categoryId/photos`). */
export class RoomPhotoDto {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  position: number;

  static fromEntity(photo: RoomCategoryPhoto): RoomPhotoDto {
    const dto = new RoomPhotoDto();
    dto.id = photo.id;
    dto.url = roomPhotoPath(photo.id);
    dto.mimeType = photo.mimeType;
    dto.sizeBytes = photo.sizeBytes;
    dto.position = photo.position;
    return dto;
  }
}

export class ReorderRoomPhotosDto {
  @IsArray({ message: 'El orden debe ser un arreglo de ids' })
  @ArrayMaxSize(MAX_ROOM_PHOTOS, {
    message: `La galería no puede tener más de ${MAX_ROOM_PHOTOS} fotos`,
  })
  @IsUUID('all', { each: true, message: 'Cada foto debe ser un id válido' })
  ids!: string[];
}
