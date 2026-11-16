import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaginatedResultDto } from '../reservation/dto/adminReservation.dto';
import { todayIn } from '../spa/model/spa.model';
import { SupportHoursService } from '../supportHours/supportHours.service';
import { buildPromotionsBlock, PromotionModel } from './promotion.model';
import { PromotionRepository } from './promotion.repository';
import {
  ListPromotionsQueryDto,
  PromotionDto,
  SavePromotionDto,
} from './dto/promotion.dto';

@Injectable()
export class PromotionService {
  constructor(
    private readonly promotionRepository: PromotionRepository,
    private readonly supportHoursService: SupportHoursService,
  ) {}

  async list(
    query: ListPromotionsQueryDto,
    now: Date = new Date(),
  ): Promise<PaginatedResultDto<PromotionDto>> {
    const today = this.today(now);
    const { items, total } = await this.promotionRepository.findPage({
      status: query.status,
      today,
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      data: items.map((model) => PromotionDto.fromModel(model, today)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async create(
    payload: SavePromotionDto,
    now: Date = new Date(),
  ): Promise<PromotionDto> {
    const today = this.today(now);
    const model = PromotionModel.create(this.toData(payload));
    this.assertValid(model);
    if (model.endDate < today) {
      throw new BadRequestException('La fecha de fin ya pasó');
    }

    return PromotionDto.fromModel(
      await this.promotionRepository.insert(model),
      today,
    );
  }

  async update(
    id: string,
    payload: SavePromotionDto,
    now: Date = new Date(),
  ): Promise<PromotionDto> {
    const model = await this.getOrFail(id);
    model.applyChanges(this.toData(payload));
    this.assertValid(model);

    await this.promotionRepository.update(model);
    return PromotionDto.fromModel(model, this.today(now));
  }

  async setEnabled(
    id: string,
    enabled: boolean,
    now: Date = new Date(),
  ): Promise<PromotionDto> {
    const model = await this.getOrFail(id);
    model.enabled = enabled;

    await this.promotionRepository.update(model);
    return PromotionDto.fromModel(model, this.today(now));
  }

  async remove(id: string): Promise<void> {
    await this.getOrFail(id);
    await this.promotionRepository.delete(id);
  }

  /** Las que se pueden ofrecer ahora. Cotizaciones y Chamber leen siempre de acá. */
  listActive(now: Date = new Date()): Promise<PromotionModel[]> {
    return this.promotionRepository.findActive(this.today(now));
  }

  async getChatBlock(now: Date = new Date()): Promise<string> {
    return buildPromotionsBlock(await this.listActive(now));
  }

  private toData(payload: SavePromotionDto) {
    return {
      title: payload.title,
      description: payload.description,
      discountPercentage: payload.discountPercentage,
      startDate: payload.startDate,
      endDate: payload.endDate,
      target: payload.target,
      minNights: payload.minNights ?? null,
    };
  }

  private assertValid(model: PromotionModel): void {
    const error = model.getError();
    if (error) throw new BadRequestException(error);
  }

  private async getOrFail(id: string): Promise<PromotionModel> {
    const model = await this.promotionRepository.findById(id);
    if (!model) throw new NotFoundException('Promoción no encontrada');
    return model;
  }

  private today(now: Date): string {
    return todayIn(this.supportHoursService.getTimeZone(), now);
  }
}
