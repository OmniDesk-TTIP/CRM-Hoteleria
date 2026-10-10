import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SpaService } from './spa.service';
import { SpaServiceDto } from './dto/spaService.dto';
import { CreateSpaServiceDto } from './dto/createSpaService.dto';
import { UpdateSpaServiceDto } from './dto/updateSpaService.dto';
import { RolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/auth.decorators';
import { UserRole } from '../../infrastructure/database/entities/User.entity';

@Controller('spa-services')
export class SpaController {
  constructor(private readonly spaService: SpaService) {}

  @Get()
  async list(): Promise<SpaServiceDto[]> {
    const services = await this.spaService.list();
    return services.map((model) => SpaServiceDto.fromModel(model));
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Post()
  async create(@Body() body: CreateSpaServiceDto): Promise<SpaServiceDto> {
    return SpaServiceDto.fromModel(await this.spaService.create(body));
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateSpaServiceDto,
  ): Promise<SpaServiceDto> {
    return SpaServiceDto.fromModel(await this.spaService.update(id, body));
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.spaService.remove(id);
  }
}
