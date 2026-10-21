import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { toTrimmedString } from '../../../common/transforms';
import { MenuItemStatus } from '../../../infrastructure/database/entities/RestaurantMenuItem.entity';
import { MenuItemModel } from '../model/restaurant.model';

export class CreateMenuItemDto {
  @Transform(toTrimmedString)
  @IsString({ message: 'El nombre debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El nombre no puede estar vacío' })
  @MaxLength(120, { message: 'El nombre es demasiado largo' })
  name!: string;

  @IsOptional()
  @Transform(toTrimmedString)
  @IsString({ message: 'La descripción debe ser una cadena de texto' })
  @MaxLength(500, { message: 'La descripción es demasiado larga' })
  description?: string;

  @Transform(toTrimmedString)
  @IsString({ message: 'La sección debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'La sección no puede estar vacía' })
  @MaxLength(60, { message: 'La sección es demasiado larga' })
  category!: string;

  @IsNumber({}, { message: 'El precio debe ser un número' })
  @IsPositive({ message: 'El precio debe ser un valor positivo' })
  price!: number;

  @IsOptional()
  @IsIn(Object.values(MenuItemStatus), { message: 'Estado inválido' })
  status?: MenuItemStatus;
}

export class UpdateMenuItemDto {
  @IsOptional()
  @Transform(toTrimmedString)
  @IsString({ message: 'El nombre debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El nombre no puede estar vacío' })
  @MaxLength(120, { message: 'El nombre es demasiado largo' })
  name?: string;

  /** Vacío borra la descripción. */
  @IsOptional()
  @Transform(toTrimmedString)
  @IsString({ message: 'La descripción debe ser una cadena de texto' })
  @MaxLength(500, { message: 'La descripción es demasiado larga' })
  description?: string;

  @IsOptional()
  @Transform(toTrimmedString)
  @IsString({ message: 'La sección debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'La sección no puede estar vacía' })
  @MaxLength(60, { message: 'La sección es demasiado larga' })
  category?: string;

  @IsOptional()
  @IsNumber({}, { message: 'El precio debe ser un número' })
  @IsPositive({ message: 'El precio debe ser un valor positivo' })
  price?: number;

  @IsOptional()
  @IsIn(Object.values(MenuItemStatus), { message: 'Estado inválido' })
  status?: MenuItemStatus;
}

/** Respuesta del panel (`/restaurant/menu-items`): incluye el estado, también de los inactivos. */
export class MenuItemDto {
  id: string;
  name: string;
  description: string | null;
  category: string;
  price: number;
  status: MenuItemStatus;

  static fromModel(model: MenuItemModel): MenuItemDto {
    const dto = new MenuItemDto();
    dto.id = model.id;
    dto.name = model.name;
    dto.description = model.description;
    dto.category = model.category;
    dto.price = model.price;
    dto.status = model.status;
    return dto;
  }
}
