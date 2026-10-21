import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';
import {
  RestaurantShift,
  RestaurantStatus,
} from '../../../infrastructure/database/entities/RestaurantSettings.entity';
import {
  groupMenu,
  MenuItemModel,
  RestaurantSettingsModel,
  sortShifts,
} from '../model/restaurant.model';
import {
  MAX_PHOTOS,
  RestaurantPhotoModel,
} from '../model/restaurantPhoto.model';

/** Respuesta del panel (`GET /restaurant`). `configured` es false mientras no se guardó nunca. */
export class RestaurantSettingsDto {
  configured: boolean;
  status: RestaurantStatus;
  description: string | null;
  availableWeekdays: number[];
  shifts: RestaurantShift[];
  maxPartySize: number;

  static fromModel(
    model: RestaurantSettingsModel,
    configured: boolean,
  ): RestaurantSettingsDto {
    const dto = new RestaurantSettingsDto();
    dto.configured = configured;
    dto.status = model.status;
    dto.description = model.description;
    dto.availableWeekdays = model.availableWeekdays;
    dto.shifts = sortShifts(model.shifts);
    dto.maxPartySize = model.maxPartySize;
    return dto;
  }
}

export class RestaurantPhotoDto {
  id: string;
  /** Ruta pública de la imagen, relativa a la URL del back. */
  url: string;
  mimeType: string;
  sizeBytes: number;
  position: number;

  static fromModel(model: RestaurantPhotoModel): RestaurantPhotoDto {
    const dto = new RestaurantPhotoDto();
    dto.id = model.id;
    dto.url = model.publicPath();
    dto.mimeType = model.mimeType;
    dto.sizeBytes = model.sizeBytes;
    dto.position = model.position;
    return dto;
  }
}

/** `PUT /restaurant/photos/order`: todos los ids de la galería, en el orden nuevo. */
export class ReorderRestaurantPhotosDto {
  @IsArray({ message: 'El orden debe ser un arreglo de ids' })
  @ArrayMaxSize(MAX_PHOTOS, {
    message: `La galería no puede tener más de ${MAX_PHOTOS} fotos`,
  })
  @IsUUID('all', { each: true, message: 'Cada foto debe ser un id válido' })
  ids!: string[];
}

// ───────── Landing (`GET /public/restaurant`) ─────────

export interface PublicMenuItemDto {
  id: string;
  name: string;
  description: string | null;
  price: number;
}

export interface PublicMenuSectionDto {
  category: string;
  items: PublicMenuItemDto[];
}

/**
 * Lo que la web pública del hotel muestra del restó (CA1/CA6). Solo trae lo habilitado (CA7):
 * con el restó deshabilitado `available` es false y no se publica nada más.
 */
export interface PublicRestaurantDto {
  available: boolean;
  description: string | null;
  availableWeekdays: number[];
  shifts: RestaurantShift[];
  menu: PublicMenuSectionDto[];
  photos: { id: string; url: string }[];
}

export function toPublicRestaurant(
  settings: RestaurantSettingsModel | null,
  menu: MenuItemModel[],
  photos: RestaurantPhotoModel[],
): PublicRestaurantDto {
  if (!settings || !settings.isActive()) {
    return {
      available: false,
      description: null,
      availableWeekdays: [],
      shifts: [],
      menu: [],
      photos: [],
    };
  }

  return {
    available: true,
    description: settings.description,
    availableWeekdays: settings.availableWeekdays,
    shifts: sortShifts(settings.shifts),
    menu: groupMenu(menu).map((section) => ({
      category: section.category,
      items: section.items.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        price: item.price,
      })),
    })),
    photos: photos.map((photo) => ({
      id: photo.id,
      url: photo.publicPath(),
    })),
  };
}
