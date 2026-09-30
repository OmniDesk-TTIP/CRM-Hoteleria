import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { SupportHours } from '../../infrastructure/database/entities/SupportHours.entity';

@Injectable()
export class SupportHoursRepository {
  constructor(private readonly em: EntityManager) {}

  async findAll(): Promise<SupportHours[]> {
    return this.em.find(SupportHours, {}, { orderBy: { weekday: 'ASC' } });
  }

  async count(): Promise<number> {
    return this.em.count(SupportHours);
  }

  create(day: { weekday: number; isClosed?: boolean; opensAt?: string; closesAt?: string }): SupportHours {
    return this.em.create(SupportHours, day);
  }

  async flush(): Promise<void> {
    await this.em.flush();
  }
}
