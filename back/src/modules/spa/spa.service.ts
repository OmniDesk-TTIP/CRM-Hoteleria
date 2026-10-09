import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReservationRepository } from '../reservation/reservation.repository';
import { SupportHoursService } from '../supportHours/supportHours.service';
import { SpaRepository } from './spa.repository';
import {
  buildGuestServicesBlock,
  EligibleStay,
  findEligibleReservation,
  SpaServiceModel,
  toCalendarDayString,
  todayIn,
} from './model/spa.model';
import { CreateSpaServiceDto } from './dto/createSpaService.dto';
import { UpdateSpaServiceDto } from './dto/updateSpaService.dto';

@Injectable()
export class SpaService {
  constructor(
    private readonly spaRepository: SpaRepository,
    private readonly reservationRepository: ReservationRepository,
    private readonly supportHoursService: SupportHoursService,
  ) {}

  list(): Promise<SpaServiceModel[]> {
    return this.spaRepository.findAll();
  }

  /** Servicios que se pueden ofrecer hoy: el bot lee siempre de acá (CA7). */
  listActive(): Promise<SpaServiceModel[]> {
    return this.spaRepository.findActive();
  }

  findById(id: string): Promise<SpaServiceModel | null> {
    return this.spaRepository.findById(id);
  }

  /** CA2: la reserva confirmada (en curso o futura) que habilita al huesped, o null si no hay. */
  async findEligibleStay(
    telegramUserId: string,
    now: Date = new Date(),
  ): Promise<EligibleStay | null> {
    const reservations =
      await this.reservationRepository.findConfirmedByTelegramUserId(
        telegramUserId,
      );
    const today = todayIn(this.supportHoursService.getTimeZone(), now);

    const eligible = findEligibleReservation(
      reservations.map((reservation) => ({
        status: reservation.status,
        checkIn: toCalendarDayString(reservation.checkIn),
        checkOut: toCalendarDayString(reservation.checkOut),
        reservationId: reservation.id,
        guestFullName: reservation.guestFullName,
      })),
      today,
    );
    if (!eligible) return null;

    return {
      reservationId: eligible.reservationId,
      guestFullName: eligible.guestFullName,
      stay: { checkIn: eligible.checkIn, checkOut: eligible.checkOut },
      today,
    };
  }

  /**
   * Seccion de servicios para el contexto de Chamber, o null si el huesped no es elegible (CA2).
   * Siempre lee de la DB: lo que el admin deshabilita desaparece en la proxima consulta (CA7).
   */
  async getGuestContextBlock(telegramUserId: string): Promise<string | null> {
    if (!(await this.findEligibleStay(telegramUserId))) return null;

    return buildGuestServicesBlock(await this.listActive());
  }

  async create(payload: CreateSpaServiceDto): Promise<SpaServiceModel> {
    await this.assertNameIsFree(payload.name);

    const model = SpaServiceModel.create(payload);
    this.assertValidSchedule(model);

    await this.spaRepository.insert(model);
    return model;
  }

  async update(
    id: string,
    payload: UpdateSpaServiceDto,
  ): Promise<SpaServiceModel> {
    const model = await this.getOrFail(id);

    if (
      payload.name &&
      payload.name.toLowerCase() !== model.name.toLowerCase()
    ) {
      await this.assertNameIsFree(payload.name, id);
    }

    model.applyChanges(payload);
    this.assertValidSchedule(model);

    await this.spaRepository.update(model);
    return model;
  }

  async remove(id: string): Promise<void> {
    const model = await this.getOrFail(id);
    if (!model.isActive()) return;

    model.deactivate();
    await this.spaRepository.update(model);
  }

  private async getOrFail(id: string): Promise<SpaServiceModel> {
    const model = await this.spaRepository.findById(id);
    if (!model) throw new NotFoundException('Servicio de spa no encontrado');
    return model;
  }

  private async assertNameIsFree(
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.spaRepository.findByName(name, excludeId);
    if (existing) {
      throw new ConflictException(
        'Ya existe un servicio de spa con ese nombre',
      );
    }
  }

  private assertValidSchedule(model: SpaServiceModel): void {
    const error = model.getScheduleError();
    if (error) throw new BadRequestException(error);
  }
}
