import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PhotoContent,
  RestaurantPhotoRepository,
} from './restaurantPhoto.repository';
import {
  detectImageType,
  isSamePhotoSet,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
  RestaurantPhotoModel,
} from './model/restaurantPhoto.model';

/** Galería del restó (CA6): el admin sube, ordena y elimina; la landing la muestra. */
@Injectable()
export class RestaurantPhotoService {
  constructor(private readonly photoRepository: RestaurantPhotoRepository) {}

  list(): Promise<RestaurantPhotoModel[]> {
    return this.photoRepository.findAll();
  }

  async upload(buffer: Buffer): Promise<RestaurantPhotoModel> {
    if (buffer.length === 0)
      throw new BadRequestException('La imagen está vacía');
    if (buffer.length > MAX_PHOTO_BYTES) {
      throw new BadRequestException(
        `La imagen supera el tamaño máximo (${MAX_PHOTO_BYTES / 1024 / 1024} MB)`,
      );
    }

    const mimeType = detectImageType(buffer);
    if (!mimeType) {
      throw new BadRequestException('Solo se aceptan imágenes JPG, PNG o WebP');
    }

    if ((await this.photoRepository.count()) >= MAX_PHOTOS) {
      throw new BadRequestException(
        `La galería ya tiene ${MAX_PHOTOS} fotos: eliminá alguna para subir otra`,
      );
    }

    return this.photoRepository.insert(buffer, mimeType);
  }

  async reorder(ids: string[]): Promise<RestaurantPhotoModel[]> {
    const current = await this.photoRepository.findAll();
    if (
      !isSamePhotoSet(
        current.map((photo) => photo.id),
        ids,
      )
    ) {
      throw new BadRequestException(
        'El orden tiene que incluir todas las fotos de la galería, una sola vez',
      );
    }

    await this.photoRepository.updatePositions(ids);
    return this.photoRepository.findAll();
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.photoRepository.delete(id);
    if (!deleted) throw new NotFoundException('Foto no encontrada');
  }

  async getContent(id: string): Promise<PhotoContent> {
    const content = await this.photoRepository.findContent(id);
    if (!content) throw new NotFoundException('Foto no encontrada');
    return content;
  }
}
