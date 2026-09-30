import { SupportHours } from '../../../infrastructure/database/entities/SupportHours.entity';

export class SupportHoursDayDto {
  /** 0 = domingo … 6 = sábado, igual que Date.getDay(). */
  weekday!: number;
  isClosed!: boolean;
  opensAt!: string;
  closesAt!: string;

  static fromEntity(entity: SupportHours): SupportHoursDayDto {
    const dto = new SupportHoursDayDto();
    dto.weekday = entity.weekday;
    dto.isClosed = entity.isClosed;
    dto.opensAt = entity.opensAt;
    dto.closesAt = entity.closesAt;
    return dto;
  }
}

export class SupportHoursDto {
  /** Siempre los 7 días, ordenados de domingo a sábado. */
  days!: SupportHoursDayDto[];
  timeZone!: string;
}
