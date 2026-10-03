import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { StatisticsService } from './statistics.service';
import { StatisticsDto, StatisticsQueryDto } from './dto/statistics.dto';
import { Roles } from '../auth/auth.decorators';
import { RolesGuard } from '../auth/auth.guard';
import { UserRole } from '../../infrastructure/database/entities/User.entity';

/**
 * Métricas de rendimiento del bot (US-10). A diferencia del Home, que ve cualquier usuario
 * autenticado, esto es solo para Administradores (CA5).
 */
@Controller('statistics')
@Roles(UserRole.ADMIN)
@UseGuards(RolesGuard)
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get()
  get(@Query() query: StatisticsQueryDto): Promise<StatisticsDto> {
    return this.statisticsService.getStatistics(query.range);
  }
}
