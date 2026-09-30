import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupportHoursRepository } from './supportHours.repository';
import { SupportHoursDayDto, SupportHoursDto } from './dto/supportHours.dto';
import { UpdateSupportHoursDto } from './dto/updateSupportHours.dto';
import {
  DaySchedule,
  describeNextOpening,
  findNextOpening,
  isOpenAt,
  isValidTimeZone,
  toMinutes,
  zonedNow,
} from './supportHours.util';

const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';
const DEFAULT_OPENS_AT = '09:00';
const DEFAULT_CLOSES_AT = '21:00';

export interface SupportAvailability {
  isOpen: boolean;
  nextOpeningLabel: string | null;
}

@Injectable()
export class SupportHoursService {
  private readonly logger = new Logger(SupportHoursService.name);
  private readonly timeZone: string;

  constructor(
    private readonly supportHoursRepository: SupportHoursRepository,
    configService: ConfigService,
  ) {
    const configured = configService.get<string>('SUPPORT_TIMEZONE') ?? DEFAULT_TIMEZONE;

    if (isValidTimeZone(configured)) {
      this.timeZone = configured;
    } else {
      this.logger.warn(`SUPPORT_TIMEZONE="${configured}" no es una zona horaria válida. Se usa UTC.`);
      this.timeZone = 'UTC';
    }
  }

  getTimeZone(): string {
    return this.timeZone;
  }

  async getSchedule(): Promise<SupportHoursDto> {
    const days = await this.supportHoursRepository.findAll();
    return { days: days.map((day) => SupportHoursDayDto.fromEntity(day)), timeZone: this.timeZone };
  }

  async replaceSchedule(payload: UpdateSupportHoursDto): Promise<SupportHoursDto> {
    const weekdays = payload.days.map((day) => day.weekday);
    if (new Set(weekdays).size !== 7) {
      throw new BadRequestException('days tiene que traer exactamente un registro por día de la semana');
    }

    for (const day of payload.days) {
      if (!day.isClosed && toMinutes(day.opensAt) === toMinutes(day.closesAt)) {
        throw new BadRequestException(
          `El día ${day.weekday} abre y cierra a la misma hora. Usá isClosed para marcarlo cerrado.`,
        );
      }
    }

    const existing = await this.supportHoursRepository.findAll();
    const byWeekday = new Map(existing.map((entity) => [entity.weekday, entity]));

    for (const day of payload.days) {
      const entity = byWeekday.get(day.weekday) ?? this.supportHoursRepository.create({ weekday: day.weekday });
      entity.isClosed = day.isClosed;
      entity.opensAt = day.opensAt;
      entity.closesAt = day.closesAt;
    }

    await this.supportHoursRepository.flush();
    return this.getSchedule();
  }

  async getAvailability(now: Date = new Date()): Promise<SupportAvailability> {
    const schedule = await this.loadSchedule();
    if (schedule.length === 0) return { isOpen: true, nextOpeningLabel: null };

    const current = zonedNow(now, this.timeZone);
    if (isOpenAt(current, schedule)) return { isOpen: true, nextOpeningLabel: null };

    return { isOpen: false, nextOpeningLabel: describeNextOpening(findNextOpening(current, schedule)) };
  }

  /** Alta inicial de la semana por defecto; la usa el seeder. */
  async seedDefaultSchedule(): Promise<void> {
    for (let weekday = 0; weekday < 7; weekday++) {
      this.supportHoursRepository.create({
        weekday,
        isClosed: false,
        opensAt: DEFAULT_OPENS_AT,
        closesAt: DEFAULT_CLOSES_AT,
      });
    }

    await this.supportHoursRepository.flush();
  }

  private async loadSchedule(): Promise<DaySchedule[]> {
    const days = await this.supportHoursRepository.findAll();
    return days.map(({ weekday, isClosed, opensAt, closesAt }) => ({ weekday, isClosed, opensAt, closesAt }));
  }
}
