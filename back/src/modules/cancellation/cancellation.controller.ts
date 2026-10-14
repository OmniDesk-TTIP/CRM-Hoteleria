import {
  Body,
  Controller,
  Get,
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
import { CancellationService } from './cancellation.service';
import {
  CancellationPolicyDto,
  CompleteRefundDto,
  CreateCancellationPolicyDto,
  ListRefundsQueryDto,
  PaginatedRefundsDto,
  RefundDto,
  UpdateCancellationPolicyDto,
} from './dto/cancellation.dto';

@Controller()
export class CancellationController {
  constructor(private readonly cancellationService: CancellationService) {}

  @Get('cancellation-policies')
  async listPolicies(): Promise<CancellationPolicyDto[]> {
    const policies = await this.cancellationService.listPolicies();
    return policies.map((policy) => CancellationPolicyDto.fromModel(policy));
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Post('cancellation-policies')
  async createPolicy(
    @Body() body: CreateCancellationPolicyDto,
  ): Promise<CancellationPolicyDto> {
    return CancellationPolicyDto.fromModel(
      await this.cancellationService.createPolicy(body),
    );
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Patch('cancellation-policies/:id')
  async updatePolicy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCancellationPolicyDto,
  ): Promise<CancellationPolicyDto> {
    return CancellationPolicyDto.fromModel(
      await this.cancellationService.updatePolicy(id, body),
    );
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Post('cancellation-policies/:id/activate')
  async activatePolicy(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CancellationPolicyDto> {
    return CancellationPolicyDto.fromModel(
      await this.cancellationService.activatePolicy(id),
    );
  }

  @Get('refunds')
  listRefunds(@Query() query: ListRefundsQueryDto): Promise<PaginatedRefundsDto> {
    return this.cancellationService.listRefunds(query);
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Patch('refunds/:reservationId/complete')
  completeRefund(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Body() body: CompleteRefundDto,
  ): Promise<RefundDto> {
    return this.cancellationService.completeRefund(reservationId, body);
  }
}