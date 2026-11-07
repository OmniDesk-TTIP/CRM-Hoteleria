import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RoomPhotoRepository } from './roomPhoto.repository';
import { MAX_ROOM_PHOTOS, RoomPhotoDto } from './dto/roomPhoto.dto';
import { RoomCategory } from '../../infrastructure/database/entities/RoomCategory.entity';
import {
  assertValidPhoto,
  isSamePhotoSet,
  PhotoContent,
} from '../../common/photo.util';

@Injectable()
export class RoomPhotoService {
  constructor(private readonly photoRepository: RoomPhotoRepository) {}

  async list(categoryId: string): Promise<RoomPhotoDto[]> {
    await this.getCategoryOrFail(categoryId);
    return this.listDtos(categoryId);
  }

  async upload(categoryId: string, buffer: Buffer): Promise<RoomPhotoDto> {
    const category = await this.getCategoryOrFail(categoryId);
    const mimeType = assertValidPhoto(buffer);

    if (
      (await this.photoRepository.countByCategory(categoryId)) >=
      MAX_ROOM_PHOTOS
    ) {
      throw new BadRequestException(
        `Este tipo ya tiene ${MAX_ROOM_PHOTOS} fotos: eliminá alguna para subir otra`,
      );
    }

    return RoomPhotoDto.fromEntity(
      await this.photoRepository.insert(category, buffer, mimeType),
    );
  }

  async reorder(categoryId: string, ids: string[]): Promise<RoomPhotoDto[]> {
    await this.getCategoryOrFail(categoryId);
    const current = await this.photoRepository.findByCategory(categoryId);
    if (
      !isSamePhotoSet(
        current.map((photo) => photo.id),
        ids,
      )
    ) {
      throw new BadRequestException(
        'El orden tiene que incluir todas las fotos del tipo, una sola vez',
      );
    }

    await this.photoRepository.updatePositions(ids);
    return this.listDtos(categoryId);
  }

  async remove(categoryId: string, id: string): Promise<void> {
    const deleted = await this.photoRepository.delete(categoryId, id);
    if (!deleted) throw new NotFoundException('Foto no encontrada');
  }

  async getContent(id: string): Promise<PhotoContent> {
    const content = await this.photoRepository.findContent(id);
    if (!content) throw new NotFoundException('Foto no encontrada');
    return content;
  }

  private async listDtos(categoryId: string): Promise<RoomPhotoDto[]> {
    const photos = await this.photoRepository.findByCategory(categoryId);
    return photos.map((photo) => RoomPhotoDto.fromEntity(photo));
  }

  private async getCategoryOrFail(categoryId: string): Promise<RoomCategory> {
    const category = await this.photoRepository.findCategoryById(categoryId);
    if (!category) {
      throw new NotFoundException('Tipo de habitación no encontrado');
    }
    return category;
  }
}
