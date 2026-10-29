import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { trimString } from '../../common/transforms';
import {
  RoomServiceOrderItem,
  RoomServiceOrderStatus,
  RoomServicePaymentStatus,
} from '../../infrastructure/database/entities/RoomServiceOrder.entity';
import { groupMenu, MenuItemModel } from '../restaurant/model/restaurant.model';
import { PublicMenuSectionDto } from '../restaurant/dto/restaurant.dto';
import {
  MAX_ORDER_LINES,
  MAX_QUANTITY_PER_ITEM,
  RoomServiceHours,
  RoomServiceOrderModel,
} from './roomService.model';

// ───────── Chamber (`prepare_room_service_order`) ─────────

export class RoomServiceOrderLineDto {
  @IsUUID('all', { message: 'El plato debe ser un id válido' })
  menuItemId!: string;

  @Type(() => Number)
  @IsInt({ message: 'La cantidad debe ser un número entero' })
  @Min(1, { message: 'La cantidad tiene que ser al menos 1' })
  @Max(MAX_QUANTITY_PER_ITEM, {
    message: `La cantidad no puede superar ${MAX_QUANTITY_PER_ITEM}`,
  })
  quantity!: number;

  @IsOptional()
  @Transform(trimString)
  @IsString({ message: 'La aclaración debe ser una cadena de texto' })
  @MaxLength(200, { message: 'La aclaración es demasiado larga' })
  notes?: string;
}

export class PrepareRoomServiceOrderDto {
  @IsArray({ message: 'Los platos deben ser un arreglo' })
  @ArrayMinSize(1, { message: 'Indicá al menos un plato' })
  @ArrayMaxSize(MAX_ORDER_LINES, {
    message: `No puede haber más de ${MAX_ORDER_LINES} platos`,
  })
  @ValidateNested({ each: true })
  @Type(() => RoomServiceOrderLineDto)
  items!: RoomServiceOrderLineDto[];

  @IsOptional()
  @Transform(trimString)
  @IsString({ message: 'La aclaración debe ser una cadena de texto' })
  @MaxLength(300, { message: 'La aclaración es demasiado larga' })
  notes?: string;
}

// ───────── Panel (`/room-service-orders`) ─────────

/** Estados que el panel puede listar: el borrador del chat nunca se muestra. */
export const LISTABLE_STATUSES = [
  RoomServiceOrderStatus.RECEIVED,
  RoomServiceOrderStatus.IN_PREPARATION,
  RoomServiceOrderStatus.DELIVERED,
  RoomServiceOrderStatus.CANCELLED,
];

export class ListRoomServiceOrdersQueryDto {
  @IsOptional()
  @IsIn(LISTABLE_STATUSES, { message: 'Estado inválido' })
  status?: RoomServiceOrderStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page debe ser un número entero' })
  @Min(1, { message: 'page debe ser mayor a 0' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pageSize debe ser un número entero' })
  @Min(1, { message: 'pageSize debe ser mayor a 0' })
  @Max(100, { message: 'pageSize no puede superar 100' })
  pageSize: number = 10;
}

export class UpdateRoomServiceOrderStatusDto {
  @IsIn(
    [
      RoomServiceOrderStatus.IN_PREPARATION,
      RoomServiceOrderStatus.DELIVERED,
      RoomServiceOrderStatus.CANCELLED,
    ],
    { message: 'Estado inválido' },
  )
  status!: RoomServiceOrderStatus;
}

export class RoomServiceOrderDto {
  id: string;
  status: RoomServiceOrderStatus;
  paymentStatus: RoomServicePaymentStatus;
  guestFullName: string;
  roomNumber: string;
  roomReservationId: string;
  items: RoomServiceOrderItem[];
  notes: string | null;
  total: number;
  /** Fecha y hora en que el huésped confirmó el pedido. */
  confirmedAt: string | null;

  static fromModel(model: RoomServiceOrderModel): RoomServiceOrderDto {
    const dto = new RoomServiceOrderDto();
    dto.id = model.id;
    dto.status = model.status;
    dto.paymentStatus = model.paymentStatus;
    dto.guestFullName = model.guestFullName;
    dto.roomNumber = model.roomNumber;
    dto.roomReservationId = model.roomReservationId;
    dto.items = model.items;
    dto.notes = model.notes;
    dto.total = model.total;
    dto.confirmedAt = model.confirmedAt
      ? model.confirmedAt.toISOString()
      : null;
    return dto;
  }
}

export interface PaginatedRoomServiceOrdersDto {
  items: RoomServiceOrderDto[];
  total: number;
  page: number;
  pageSize: number;
}

// ───────── Landing (`GET /public/room-service`) ─────────

export interface PublicRoomServiceDto {
  available: boolean;
  opensAt: string | null;
  closesAt: string | null;
  menu: PublicMenuSectionDto[];
}

export function toPublicRoomService(
  hours: RoomServiceHours | null,
  menu: MenuItemModel[],
): PublicRoomServiceDto {
  if (!hours || !hours.enabled) {
    return { available: false, opensAt: null, closesAt: null, menu: [] };
  }
  return {
    available: true,
    opensAt: hours.opensAt,
    closesAt: hours.closesAt,
    menu: groupMenu(menu).map((section) => ({
      category: section.category,
      items: section.items.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        price: item.price,
      })),
    })),
  };
}
