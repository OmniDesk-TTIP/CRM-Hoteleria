import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardStatusDto, DashboardSummaryDto } from './dto/dashboard.dto';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthUser } from '../auth/auth.types';

/** Home del panel. Solo lo protege el guard global: cualquier usuario autenticado lo ve. */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  summary(@CurrentUser() user: AuthUser): Promise<DashboardSummaryDto> {
    return this.dashboardService.getSummary(user);
  }

  // Lo pide el layout en todas las páginas, por eso va aparte y liviano.
  @Get('status')
  status(): Promise<DashboardStatusDto> {
    return this.dashboardService.getStatus();
  }
}
