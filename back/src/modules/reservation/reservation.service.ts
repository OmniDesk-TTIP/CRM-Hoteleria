import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BookingProcess,
  BookingProcessStep,
} from '../../infrastructure/database/entities/BookingProcess.entity';
import { Room } from '../../infrastructure/database/entities/Room.entity';
import { Reservation } from '../../infrastructure/database/entities/Reservation.entity';
import { SearchAvailabilityDto } from '../bookingProcess/dto/searchAvailability.dto';
import { BookingProcessService } from '../bookingProcess/bookingProcess.service';
import { RoomRepository } from '../room/room.repository';
import { CancellationService } from '../cancellation/cancellation.service';
import { PromotionTarget } from '../../infrastructure/database/entities/Promotion.entity';
import { PromotionService } from '../promotion/promotion.service';
import {
  buildPromotionLine,
  describeAmount,
  priceWithPromotions,
  PromotionModel,
  PromotionPrice,
  toAppliedPromotion,
} from '../promotion/promotion.model';
import { round2 } from '../../common/number.util';
import { ReservationRepository } from './reservation.repository';
import { formatDate, parseDate } from '../bookingProcess/date.util';
import {
  PaymentService,
  RESERVATION_HOLD_MINUTES,
} from '../payment/payment.service';
import { escapeHtml, htmlLink } from '../telegram/telegram.format';
import { ConfirmReservationDto } from './dto/confirmReservation.dto';
import { toCalendarDayString } from '../spa/model/spa.model';
import {
  DayRange,
  findGapFreeVariants,
  fromDayNumber,
  pickRoomAvoidingGap,
  RoomSchedule,
  StayVariant,
  toDayNumber,
} from './reservation.model';

const DEPOSIT_PERCENTAGE = 0.3;

export const ALTERNATIVE_DATES_WINDOW_DAYS = 7;
const MAX_ALTERNATIVE_DATES = 3;
const MAX_SHORTER_ALTERNATIVES = 1;
const MIN_SHORTER_STAY_NIGHTS = 2;

const MAX_GAP_VARIANTS = 2;

const GAP_LOOKUP_MARGIN_DAYS = 3;
const GAP_EDGE_MARGIN_DAYS = 2;

const MS_PER_DAY = 1000 * 3600 * 24;

/** Fecha de una columna `date` como DD-MM-YYYY, sin que el huso horario corra el día. */
const toChatDay = (value: Date | string): string =>
  toCalendarDayString(value).split('-').reverse().join('-');

export interface AlternativeDates {
  checkIn: string;
  checkOut: string;
  nights: number;
  isShorterStay: boolean;
  roomCategory: string;
  /** Con el descuento de `promotion` ya aplicado. */
  totalAmount: number;
  promotion?: string;
}

export type AvailabilityResult =
  | { available: true; reply: string }
  | { available: false; alternatives: AlternativeDates[] };

interface CandidateBlock {
  start: number;
  nights: number;
  room: Room;
  leavesGap: boolean;
}

interface RoomFreeNights {
  room: Room;
  free: boolean[];
  schedule: RoomSchedule;
}

interface VariantOption {
  variant: StayVariant;
  room: Room;
}

interface RoomChoice {
  room: Room;
  leavesGap: boolean;
  reservations: Reservation[];
}

@Injectable()
export class ReservationService {
  constructor(
    private readonly bookingProcessService: BookingProcessService,
    private readonly roomRepository: RoomRepository,
    private readonly reservationRepository: ReservationRepository,
    private readonly paymentService: PaymentService,
    private readonly configService: ConfigService,
    private readonly cancellationService: CancellationService,
    private readonly promotionService: PromotionService,
  ) {}

  async searchAvailability(
    telegramUserId: string,
    activeBooking: BookingProcess | null,
    bookingData: SearchAvailabilityDto,
  ): Promise<AvailabilityResult> {
    const isInsistingOnSameDates =
      !!activeBooking &&
      activeBooking.step === BookingProcessStep.IN_PROGRESS &&
      activeBooking.checkIn === bookingData.checkIn &&
      activeBooking.checkOut === bookingData.checkOut &&
      activeBooking.capacity === bookingData.capacity;

    const booking = this.bookingProcessService.startSearch(
      telegramUserId,
      activeBooking,
      bookingData,
    );

    const choice = await this.findAvailableRoom(
      bookingData.checkIn,
      bookingData.checkOut,
      bookingData.capacity,
    );
    const promotions = await this.promotionService.listActive();

    if (choice) {
      const nights = this.calculateNights(
        bookingData.checkIn,
        bookingData.checkOut,
      );
      const variants =
        choice.leavesGap && !isInsistingOnSameDates
          ? await this.findGapFreeVariants(bookingData, choice.reservations)
          : [];
      const price = this.priceStay(choice.room, nights, promotions);
      if (variants.length > 0) {
        this.bookingProcessService.markInProgress(booking);
      } else {
        booking.quotedTotal = price.finalAmount;
        this.bookingProcessService.markPendingConfirmation(booking);
      }

      return {
        available: true,
        reply: this.buildOfferReply(
          choice.room,
          bookingData,
          nights,
          price,
          variants,
          promotions,
        ),
      };
    }

    this.bookingProcessService.markInProgress(booking);
    const alternatives = await this.findAlternativeDates(
      bookingData.checkIn,
      bookingData.checkOut,
      bookingData.capacity,
      promotions,
    );
    return { available: false, alternatives };
  }

  async confirmReservation(
    telegramUserId: string,
    activeBooking: BookingProcess,
    guestData: ConfirmReservationDto,
  ): Promise<string> {
    const savedCheckIn = activeBooking.checkIn as string;
    const savedCheckOut = activeBooking.checkOut as string;
    const capacity = activeBooking.capacity as number;

    const roomToBook = (
      await this.findAvailableRoom(savedCheckIn, savedCheckOut, capacity)
    )?.room;

    let botReply: string;
    if (roomToBook) {
      const checkInDate = parseDate(savedCheckIn);
      const checkOutDate = parseDate(savedCheckOut);
      const nights = this.calculateNights(savedCheckIn, savedCheckOut);
      const price = this.priceStay(
        roomToBook,
        nights,
        await this.promotionService.listActive(),
      );
      const totalAmount = price.finalAmount;
      const depositAmount = this.depositFor(totalAmount);

      // La promoción pudo vencer o deshabilitarse desde la oferta: no se reserva a otro precio sin avisar.
      if (
        activeBooking.quotedTotal != null &&
        Number(activeBooking.quotedTotal) !== totalAmount
      ) {
        activeBooking.quotedTotal = totalAmount;
        return [
          `Antes de reservarte: el precio cambió desde que te lo ofrecí, las promociones disponibles ya no son las mismas.`,
          '',
          ...this.promotionLines(price),
          `El total de tu estadía (${nights} noches) ahora es de ${describeAmount(price)}, con una seña del 30% de $${depositAmount}.`,
          '',
          '¿Querés que te la reserve igual?',
        ].join('\n');
      }

      const newReservation = this.reservationRepository.create({
        room: roomToBook,
        telegramUserId,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        totalAmount,
        depositAmount,
        guestFullName: guestData.fullName,
        guestDni: guestData.dni,
        promotion: toAppliedPromotion(price),
      });

      // Primero el link de pago: si Mercado Pago falla, la reserva no se guarda (ni la arrastra el
      // flush que hace después el manejo de errores) y la búsqueda sigue esperando confirmación,
      // así el huésped puede volver a intentar.
      let preference: { preferenceId: string; initPoint: string };
      try {
        preference = await this.paymentService.createPreference(
          newReservation,
          guestData,
        );
      } catch (error) {
        this.reservationRepository.discard(newReservation);
        throw error;
      }
      newReservation.mpPreferenceId = preference.preferenceId;
      newReservation.mpInitPoint = preference.initPoint;

      this.reservationRepository.persist(newReservation);
      this.bookingProcessService.markCompleted(activeBooking);

      const paymentFormUrl = this.paymentFormUrl(newReservation.id);

      const policySummary = await this.cancellationService.getPolicySummary();

      botReply = [
        `Te estoy guardando la ${escapeHtml(roomToBook.category.name)} del ${savedCheckIn} al ${savedCheckOut}, a nombre de ${escapeHtml(guestData.fullName)}.`,
        '',
        ...this.promotionLines(price),
        `Total de la estadía: ${describeAmount(price)}`,
        `Seña para reservarla: $${depositAmount}`,
        '',
        `<b>Todavía no está confirmada.</b> Te guardo la habitación ${RESERVATION_HOLD_MINUTES} minutos; si en ese rato no entra la seña, se libera para otro huésped.`,
        '',
        'Aboná la seña acá:',
        htmlLink(paymentFormUrl, paymentFormUrl),
        '',
        'Apenas se acredite el pago te escribo por acá y ahí sí queda confirmada.',
        ...(policySummary ? ['', policySummary] : []),
      ].join('\n');
    } else {
      botReply = `Uy, parece que alguien acaba de reservar la última habitación disponible para esas fechas mientras hablábamos. ¿Te gustaría buscar otra fecha?`;
      this.bookingProcessService.markInProgress(activeBooking);
    }

    return botReply;
  }

  async hasPendingPayment(
    telegramUserId: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    const reservations = await this.findAwaitingPayment(telegramUserId, now);
    return reservations.length > 0;
  }

  /** Respuesta fija con el link de pago de las reservas que todavía esperan la seña. */
  async buildPendingPaymentReply(
    telegramUserId: string,
    now: Date = new Date(),
  ): Promise<string | null> {
    const reservations = await this.findAwaitingPayment(telegramUserId, now);
    if (reservations.length === 0) return null;

    const lines = reservations.map((reservation) => {
      const link = this.paymentFormUrl(reservation.id);
      const minutesLeft = Math.max(
        1,
        Math.ceil(
          (reservation.createdAt.getTime() +
            RESERVATION_HOLD_MINUTES * 60 * 1000 -
            now.getTime()) /
            60000,
        ),
      );
      return [
        `Reserva del ${toChatDay(reservation.checkIn)} al ${toChatDay(reservation.checkOut)}: seña de <b>$${Number(reservation.depositAmount)}</b>.`,
        `Aboná acá: ${htmlLink(link, link)}`,
        `Te la guardo ${minutesLeft} ${minutesLeft === 1 ? 'minuto' : 'minutos'} más; si no entra el pago, se libera.`,
      ].join('\n');
    });

    return [
      ...lines,
      '',
      'Apenas se acredite el pago te escribo por acá y ahí sí queda confirmada.',
    ].join('\n');
  }

  private findAwaitingPayment(
    telegramUserId: string,
    now: Date,
  ): Promise<Reservation[]> {
    return this.reservationRepository.findAwaitingPaymentByTelegramUserId(
      telegramUserId,
      new Date(now.getTime() - RESERVATION_HOLD_MINUTES * 60 * 1000),
    );
  }

  private paymentFormUrl(reservationId: string): string {
    const frontendBaseUrl =
      this.configService.getOrThrow<string>('FRONTEND_BASE_URL');
    return `${frontendBaseUrl.replace(/\/+$/, '')}/payment/form/${reservationId}`;
  }

  private calculateNights(checkIn: string, checkOut: string): number {
    return daysBetween(parseDate(checkIn), parseDate(checkOut));
  }

  private priceStay(
    room: Room,
    nights: number,
    promotions: PromotionModel[],
  ): PromotionPrice {
    return priceWithPromotions(
      Number(room.category.basePrice) * nights,
      promotions,
      { target: PromotionTarget.ROOMS, nights },
    );
  }

  private depositFor(totalAmount: number): number {
    return round2(totalAmount * DEPOSIT_PERCENTAGE);
  }

  private promotionLines({ promotion }: PromotionPrice): string[] {
    return promotion ? [buildPromotionLine(promotion), ''] : [];
  }

  private async findAvailableRoom(
    checkIn: string,
    checkOut: string,
    capacity: number,
  ): Promise<RoomChoice | null> {
    const overlappingReservations =
      await this.reservationRepository.findOverlapping(
        parseDate(checkIn),
        parseDate(checkOut),
      );
    const reservedRoomIds = overlappingReservations.map((r) => r.room.id);

    const availableRooms = await this.roomRepository.findByCapacityExcluding(
      capacity,
      reservedRoomIds,
    );
    if (availableRooms.length === 0) return null;

    const reservations = await this.reservationRepository.findOverlapping(
      addDays(parseDate(checkIn), -GAP_LOOKUP_MARGIN_DAYS),
      addDays(parseDate(checkOut), GAP_LOOKUP_MARGIN_DAYS),
    );
    const picked = pickRoomAvoidingGap(
      buildSchedules(availableRooms, reservations),
      toStay(checkIn, checkOut),
    );
    if (!picked) return null;

    const room = availableRooms.find((r) => r.id === picked.schedule.roomId)!;
    return { room, leavesGap: picked.leavesGap, reservations };
  }

  private async findGapFreeVariants(
    { checkIn, checkOut, capacity }: SearchAvailabilityDto,
    reservations: Reservation[],
  ): Promise<VariantOption[]> {
    const rooms = await this.roomRepository.findByCapacityExcluding(
      capacity,
      [],
    );
    const variants = findGapFreeVariants(
      toStay(checkIn, checkOut),
      buildSchedules(rooms, reservations),
      toDayNumber(startOfToday()),
      MAX_GAP_VARIANTS,
    );

    return variants.map((variant) => ({
      variant,
      room: rooms.find((room) => room.id === variant.roomId)!,
    }));
  }

  private describeVariant(
    { variant, room }: VariantOption,
    promotions: PromotionModel[],
  ): string {
    const checkIn = formatDate(fromDayNumber(variant.stay.checkIn));
    const checkOut = formatDate(fromDayNumber(variant.stay.checkOut));
    const nights = variant.stay.checkOut - variant.stay.checkIn;
    const price = this.priceStay(room, nights, promotions);
    const promotion = price.promotion
      ? ` con la promoción ${escapeHtml(price.promotion.title)}`
      : '';
    return `${escapeHtml(room.category.name)}: del ${checkIn} al ${checkOut} (${nights} noches), total ${describeAmount(price)}${promotion}`;
  }

  private buildOfferReply(
    room: Room,
    { checkIn, checkOut }: SearchAvailabilityDto,
    nights: number,
    price: PromotionPrice,
    variants: VariantOption[],
    promotions: PromotionModel[],
  ): string {
    if (variants.length > 0) {
      return [
        'Tenemos disponibilidad en estas opciones:',
        ...variants.map(
          (option) => `• ${this.describeVariant(option, promotions)}`,
        ),
        '',
        '¿Cuál te viene mejor?',
      ].join('\n');
    }

    return [
      `Tenemos disponibilidad en nuestra ${escapeHtml(room.category.name)} del ${checkIn} al ${checkOut} por $${Number(room.category.basePrice)} la noche.`,
      '',
      ...this.promotionLines(price),
      `El total de tu estadía (${nights} noches) sería de ${describeAmount(price)}, con una seña del 30% de $${this.depositFor(price.finalAmount)} para reservarla.`,
      '',
      '¿Querés que te la reserve?',
    ].join('\n');
  }

  private async findAlternativeDates(
    checkIn: string,
    checkOut: string,
    capacity: number,
    promotions: PromotionModel[],
  ): Promise<AlternativeDates[]> {
    const requestedStart = parseDate(checkIn);
    const requestedNights = daysBetween(requestedStart, parseDate(checkOut));

    const windowStart = addDays(requestedStart, -ALTERNATIVE_DATES_WINDOW_DAYS);
    const windowEnd = addDays(
      parseDate(checkOut),
      ALTERNATIVE_DATES_WINDOW_DAYS,
    );
    const windowNights = daysBetween(windowStart, windowEnd);
    const requestedIndex = ALTERNATIVE_DATES_WINDOW_DAYS;

    const [rooms, reservations] = await Promise.all([
      this.roomRepository.findByCapacityExcluding(capacity, []),
      this.reservationRepository.findOverlapping(
        addDays(windowStart, -GAP_EDGE_MARGIN_DAYS),
        addDays(windowEnd, GAP_EDGE_MARGIN_DAYS),
      ),
    ]);
    if (rooms.length === 0) return [];

    const firstBookableNight = daysBetween(windowStart, startOfToday());

    const schedules = buildSchedules(rooms, reservations);
    const freeNightsByRoom: RoomFreeNights[] = rooms.map((room, index) => {
      const free = Array.from(
        { length: windowNights },
        (_, night) => night >= firstBookableNight,
      );
      for (const reservation of reservations) {
        if (reservation.room.id !== room.id) continue;
        const from = Math.max(
          0,
          daysBetween(windowStart, toCalendarDay(reservation.checkIn)),
        );
        const to = Math.min(
          windowNights,
          daysBetween(windowStart, toCalendarDay(reservation.checkOut)),
        );
        for (let night = from; night < to; night++) free[night] = false;
      }
      return { room, free, schedule: schedules[index] };
    });

    const windowStartDay = toDayNumber(windowStart);
    const fullStays = this.findFullStays(
      freeNightsByRoom,
      requestedIndex,
      requestedNights,
      windowStartDay,
    );
    const shorterStays = this.findShorterStays(
      freeNightsByRoom,
      requestedIndex,
      requestedNights,
      windowStartDay,
    );

    const ordered = [
      ...shorterStays.slice(0, MAX_SHORTER_ALTERNATIVES),
      ...fullStays,
      ...shorterStays.slice(MAX_SHORTER_ALTERNATIVES),
    ];
    const prioritized = [
      ...ordered.filter((block) => !block.leavesGap),
      ...ordered.filter((block) => block.leavesGap),
    ];

    const seen = new Set<string>();
    const alternatives: AlternativeDates[] = [];
    for (const block of prioritized) {
      const key = `${block.start}:${block.nights}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const price = this.priceStay(block.room, block.nights, promotions);
      alternatives.push({
        checkIn: formatDate(addDays(windowStart, block.start)),
        checkOut: formatDate(addDays(windowStart, block.start + block.nights)),
        nights: block.nights,
        isShorterStay: block.nights < requestedNights,
        roomCategory: block.room.category.name,
        totalAmount: price.finalAmount,
        ...(price.promotion
          ? {
              promotion: `${price.promotion.title} (${price.promotion.discountPercentage}% de descuento)`,
            }
          : {}),
      });
      if (alternatives.length === MAX_ALTERNATIVE_DATES) break;
    }

    return alternatives;
  }

  private findFullStays(
    freeNightsByRoom: RoomFreeNights[],
    requestedIndex: number,
    requestedNights: number,
    windowStartDay: number,
  ): CandidateBlock[] {
    const blocks: CandidateBlock[] = [];
    for (
      let distance = 1;
      distance <= ALTERNATIVE_DATES_WINDOW_DAYS;
      distance++
    ) {
      for (const start of [
        requestedIndex + distance,
        requestedIndex - distance,
      ]) {
        const freeRooms = freeNightsByRoom.filter(({ free }) =>
          isRangeFree(free, start, requestedNights),
        );
        const picked = pickRoomAvoidingGap(
          freeRooms.map(({ schedule }) => schedule),
          blockToStay(windowStartDay, start, requestedNights),
        );
        if (picked) {
          const { room } = freeRooms.find(
            ({ schedule }) => schedule === picked.schedule,
          )!;
          blocks.push({
            start,
            nights: requestedNights,
            room,
            leavesGap: picked.leavesGap,
          });
        }
      }
    }
    return blocks;
  }

  private findShorterStays(
    freeNightsByRoom: RoomFreeNights[],
    requestedIndex: number,
    requestedNights: number,
    windowStartDay: number,
  ): CandidateBlock[] {
    const maxNights = requestedNights - 1;
    const minNights = Math.max(
      MIN_SHORTER_STAY_NIGHTS,
      Math.ceil(requestedNights / 2),
    );
    if (minNights > maxNights) return [];

    const requestedEnd = requestedIndex + requestedNights;
    const overlapWithRequest = (block: CandidateBlock) =>
      Math.min(block.start + block.nights, requestedEnd) -
      Math.max(block.start, requestedIndex);

    const candidates: CandidateBlock[] = [];
    for (const { room, free, schedule } of freeNightsByRoom) {
      let runStart = 0;
      while (runStart < free.length) {
        if (!free[runStart]) {
          runStart++;
          continue;
        }

        let runEnd = runStart;
        while (runEnd < free.length && free[runEnd]) runEnd++;
        const nights = Math.min(runEnd - runStart, maxNights);
        const start = Math.min(
          Math.max(requestedIndex, runStart),
          runEnd - nights,
        );
        const block = {
          start,
          nights,
          room,
          leavesGap: schedule.leavesSingleNightGap(
            blockToStay(windowStartDay, start, nights),
          ),
        };
        if (nights >= minNights && overlapWithRequest(block) > 0)
          candidates.push(block);

        runStart = runEnd;
      }
    }

    return candidates.sort(
      (a, b) =>
        overlapWithRequest(b) - overlapWithRequest(a) ||
        b.nights - a.nights ||
        Math.abs(a.start - requestedIndex) - Math.abs(b.start - requestedIndex),
    );
  }
}

function isRangeFree(free: boolean[], start: number, nights: number): boolean {
  if (start < 0 || start + nights > free.length) return false;
  for (let night = start; night < start + nights; night++) {
    if (!free[night]) return false;
  }
  return true;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toCalendarDay(value: Date | string): Date {
  return fromDayNumber(toDayNumber(value));
}

function toStay(checkIn: string, checkOut: string): DayRange {
  return {
    checkIn: toDayNumber(parseDate(checkIn)),
    checkOut: toDayNumber(parseDate(checkOut)),
  };
}

function blockToStay(
  windowStartDay: number,
  start: number,
  nights: number,
): DayRange {
  return {
    checkIn: windowStartDay + start,
    checkOut: windowStartDay + start + nights,
  };
}

function buildSchedules(
  rooms: Room[],
  reservations: Reservation[],
): RoomSchedule[] {
  return rooms.map(
    (room) =>
      new RoomSchedule(
        room.id,
        reservations
          .filter((reservation) => reservation.room.id === room.id)
          .map((reservation) => ({
            checkIn: toDayNumber(reservation.checkIn),
            checkOut: toDayNumber(reservation.checkOut),
          })),
      ),
  );
}
