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
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/auth.decorators';
import { RolesGuard } from '../auth/auth.guard';
import { UserRole } from '../../infrastructure/database/entities/User.entity';
import { PaginatedResultDto } from '../reservation/dto/adminReservation.dto';
import { PromotionService } from './promotion.service';
import {
  ListPromotionsQueryDto,
  PromotionDto,
  SavePromotionDto,
  SetPromotionEnabledDto,
} from './dto/promotion.dto';

@Controller('promotions')
@Roles(UserRole.ADMIN)
@UseGuards(RolesGuard)
export class PromotionController {
  constructor(private readonly promotionService: PromotionService) {}

  @Get()
  list(
    @Query() query: ListPromotionsQueryDto,
  ): Promise<PaginatedResultDto<PromotionDto>> {
    return this.promotionService.list(query);
  }

  @Post()
  create(@Body() body: SavePromotionDto): Promise<PromotionDto> {
    return this.promotionService.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SavePromotionDto,
  ): Promise<PromotionDto> {
    return this.promotionService.update(id, body);
  }

  @Patch(':id/enabled')
  setEnabled(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetPromotionEnabledDto,
  ): Promise<PromotionDto> {
    return this.promotionService.setEnabled(id, body.enabled);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.promotionService.remove(id);
  }
}
