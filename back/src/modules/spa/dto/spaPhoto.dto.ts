import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';
import { MAX_SPA_PHOTOS, SpaPhotoModel } from '../model/spaPhoto.model';
import { SpaServiceModel } from '../model/spa.model';

/** Foto de la galería del spa en el panel (`/spa/photos`). */
export class SpaPhotoDto {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  position: number;

  static fromModel(model: SpaPhotoModel): SpaPhotoDto {
    const dto = new SpaPhotoDto();
    dto.id = model.id;
    dto.url = model.publicPath();
    dto.mimeType = model.mimeType;
    dto.sizeBytes = model.sizeBytes;
    dto.position = model.position;
    return dto;
  }
}

export class ReorderSpaPhotosDto {
  @IsArray({ message: 'El orden debe ser un arreglo de ids' })
  @ArrayMaxSize(MAX_SPA_PHOTOS, {
    message: `La galería no puede tener más de ${MAX_SPA_PHOTOS} fotos`,
  })
  @IsUUID('all', { each: true, message: 'Cada foto debe ser un id válido' })
  ids!: string[];
}

// ───────── Landing (`GET /public/spa`) ─────────

/** Servicio tal como lo ve la web del hotel: sin capacidad ni estado (solo llegan los activos). */
export interface PublicSpaServiceDto {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  /** Precio para clientes externos; los huéspedes no pagan. */
  price: number;
  availableWeekdays: number[];
  opensAt: string;
  closesAt: string;
}

export interface PublicSpaDto {
  services: PublicSpaServiceDto[];
  /** En el orden que eligió el admin: la primera es la portada. */
  photos: { id: string; url: string }[];
}

export function toPublicSpa(
  services: SpaServiceModel[],
  photos: SpaPhotoModel[],
): PublicSpaDto {
  return {
    services: services.map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      durationMinutes: service.durationMinutes,
      price: service.price,
      availableWeekdays: service.availableWeekdays,
      opensAt: service.opensAt,
      closesAt: service.closesAt,
    })),
    photos: photos.map((photo) => ({ id: photo.id, url: photo.publicPath() })),
  };
}
