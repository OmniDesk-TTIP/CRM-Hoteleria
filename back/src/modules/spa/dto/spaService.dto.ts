import { SpaServiceStatus } from '../../../infrastructure/database/entities/SpaService.entity';
import { SpaServiceModel } from '../model/spa.model';

/** Respuesta del panel (`/spa-services`): incluye el estado, también de los inactivos. */
export class SpaServiceDto {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  price: number;
  capacity: number;
  status: SpaServiceStatus;
  availableWeekdays: number[];
  opensAt: string;
  closesAt: string;

  static fromModel(model: SpaServiceModel): SpaServiceDto {
    const dto = new SpaServiceDto();
    dto.id = model.id;
    dto.name = model.name;
    dto.description = model.description;
    dto.durationMinutes = model.durationMinutes;
    dto.price = model.price;
    dto.capacity = model.capacity;
    dto.status = model.status;
    dto.availableWeekdays = model.availableWeekdays;
    dto.opensAt = model.opensAt;
    dto.closesAt = model.closesAt;
    return dto;
  }
}
