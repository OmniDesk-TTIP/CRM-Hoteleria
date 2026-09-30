import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { SupportHoursService } from './supportHours.service';
import { UpdateSupportHoursDto } from './dto/updateSupportHours.dto';
import { SupportHoursDto } from './dto/supportHours.dto';
import { Roles } from '../auth/auth.decorators';
import { RolesGuard } from '../auth/auth.guard';
import { UserRole } from '../../infrastructure/database/entities/User.entity';

@Controller('support-hours')
export class SupportHoursController {
  constructor(private readonly supportHoursService: SupportHoursService) {}

  @Get()
  get(): Promise<SupportHoursDto> {
    return this.supportHoursService.getSchedule();
  }

  @Put()
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  update(@Body() body: UpdateSupportHoursDto): Promise<SupportHoursDto> {
    return this.supportHoursService.replaceSchedule(body);
  }
}
