import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SupportHoursRepository } from './supportHours.repository';
import { SupportHoursService } from './supportHours.service';

@Injectable()
export class SupportHoursSeederService implements OnModuleInit {
  private readonly logger = new Logger(SupportHoursSeederService.name);

  constructor(
    private readonly supportHoursRepository: SupportHoursRepository,
    private readonly supportHoursService: SupportHoursService,
  ) {}

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;

    const count = await this.supportHoursRepository.count();
    if (count > 0) return;

    this.logger.log('No hay horarios de atención cargados. Sembrando la semana por defecto...');
    await this.supportHoursService.seedDefaultSchedule();
    this.logger.log('Horarios de atención por defecto sembrados exitosamente.');
  }
}
