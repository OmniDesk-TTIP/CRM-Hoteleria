import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingProcess } from '../../infrastructure/database/entities/BookingProcess.entity';
import { Room } from '../../infrastructure/database/entities/Room.entity';
import { SearchAvailabilityDto } from '../bookingProcess/dto/searchAvailability.dto';
import { BookingProcessService } from '../bookingProcess/bookingProcess.service';
import { RoomRepository } from '../room/room.repository';
import { ReservationRepository } from './reservation.repository';
import { formatDate, parseDate } from '../bookingProcess/date.util';
import { PaymentService, RESERVATION_HOLD_MINUTES } from '../payment/payment.service';
import { escapeHtml, htmlLink } from '../telegram/telegram.format';
import { ConfirmReservationDto } from './dto/confirmReservation.dto';

const DEPOSIT_PERCENTAGE = 0.3;

/** Días hacia atrás y hacia adelante de la fecha pedida en los que buscamos alternativas. */
export const ALTERNATIVE_DATES_WINDOW_DAYS = 7;
/** Tope de alternativas que se le ofrecen al huésped, para no abrumarlo ni inflar el prompt. */
const MAX_ALTERNATIVE_DATES = 3;
/** Cuántas estadías más cortas se muestran antes que las completas. */
const MAX_SHORTER_ALTERNATIVES = 1;
/** Piso absoluto de noches para ofrecer una estadía más corta (además de la mitad de lo pedido). */
const MIN_SHORTER_STAY_NIGHTS = 2;

const MS_PER_DAY = 1000 * 3600 * 24;

export interface AlternativeDates {
  checkIn: string;
  checkOut: string;
  nights: number;
  /** true si la alternativa tiene menos noches que las pedidas. */
  isShorterStay: boolean;
  roomCategory: string;
  totalAmount: number;
}

export type AvailabilityResult =
  | { available: true; reply: string }
  | { available: false; alternatives: AlternativeDates[] };

/** Bloque candidato expresado en índices de noche dentro de la ventana de búsqueda. */
interface CandidateBlock {
  start: number;
  nights: number;
  room: Room;
}

interface RoomFreeNights {
  room: Room;
  free: boolean[];
}

@Injectable()
export class ReservationService {
  constructor(
    private readonly bookingProcessService: BookingProcessService,
    private readonly roomRepository: RoomRepository,
    private readonly reservationRepository: ReservationRepository,
    private readonly paymentService: PaymentService,
    private readonly configService: ConfigService,
  ) {}

  async searchAvailability(
    telegramUserId: string,
    activeBooking: BookingProcess | null,
    bookingData: SearchAvailabilityDto,
  ): Promise<AvailabilityResult> {
    const booking = this.bookingProcessService.startSearch(telegramUserId, activeBooking, bookingData);

    const roomFound = await this.findAvailableRoom(bookingData.checkIn, bookingData.checkOut, bookingData.capacity);

    if (roomFound) {
      this.bookingProcessService.markPendingConfirmation(booking);

      const nights = this.calculateNights(bookingData.checkIn, bookingData.checkOut);
      const totalAmount = roomFound.category.basePrice * nights;
      const depositAmount = totalAmount * DEPOSIT_PERCENTAGE;

      const reply = `Tenemos disponibilidad en nuestra ${escapeHtml(roomFound.category.name)} del ${bookingData.checkIn} al ${bookingData.checkOut} por $${roomFound.category.basePrice} la noche.\n\nEl total de tu estadía (${nights} noches) sería de $${totalAmount}, con una seña del 30% de $${depositAmount} para reservarla.\n\n¿Querés que te la reserve?`;
      return { available: true, reply };
    }

    this.bookingProcessService.markInProgress(booking);
    const alternatives = await this.findAlternativeDates(bookingData.checkIn, bookingData.checkOut, bookingData.capacity);
    return { available: false, alternatives };
  }

  async confirmReservation(telegramUserId: string, activeBooking: BookingProcess, guestData: ConfirmReservationDto): Promise<string> {
    const savedCheckIn = activeBooking.checkIn as string;
    const savedCheckOut = activeBooking.checkOut as string;
    const capacity = activeBooking.capacity as number;

    const roomToBook = await this.findAvailableRoom(savedCheckIn, savedCheckOut, capacity);

    let botReply: string;
    if (roomToBook) {
      const checkInDate = parseDate(savedCheckIn);
      const checkOutDate = parseDate(savedCheckOut);
      const nights = this.calculateNights(savedCheckIn, savedCheckOut);
      const totalAmount = roomToBook.category.basePrice * nights;
      const depositAmount = totalAmount * DEPOSIT_PERCENTAGE;

      const newReservation = this.reservationRepository.create({
        room: roomToBook,
        telegramUserId,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        totalAmount,
        depositAmount,
        guestFullName: guestData.fullName,
        guestDni: guestData.dni,
      });

      this.reservationRepository.persist(newReservation);
      this.bookingProcessService.markCompleted(activeBooking);

      const { preferenceId, initPoint } = await this.paymentService.createPreference(newReservation, guestData);
      newReservation.mpPreferenceId = preferenceId;
      newReservation.mpInitPoint = initPoint;

      // Link al formulario de prepago del front, que muestra el resumen y de ahí manda al
      // checkout de Mercado Pago. En dev, con FRONTEND_BASE_URL apuntando a localhost, Telegram
      // descarta el href y la URL queda como texto para copiar; con un dominio real es clickeable.
      const frontendBaseUrl = this.configService.getOrThrow<string>('FRONTEND_BASE_URL');
      const paymentFormUrl = `${frontendBaseUrl}/payment/form/${newReservation.id}`;

      botReply = [
        `Te estoy guardando la ${escapeHtml(roomToBook.category.name)} del ${savedCheckIn} al ${savedCheckOut}, a nombre de ${escapeHtml(guestData.fullName)}.`,
        '',
        `Total de la estadía: $${totalAmount}`,
        `Seña para reservarla: $${depositAmount}`,
        '',
        `⏳ <b>Todavía no está confirmada.</b> Te guardo la habitación ${RESERVATION_HOLD_MINUTES} minutos; si en ese rato no entra la seña, se libera para otro huésped.`,
        '',
        '👉 Aboná la seña acá:',
        htmlLink(paymentFormUrl, paymentFormUrl),
        '',
        'Apenas se acredite el pago te escribo por acá y ahí sí queda confirmada.',
      ].join('\n');
    } else {
      botReply = `Uy, parece que alguien acaba de reservar la última habitación disponible para esas fechas mientras hablábamos. ¿Te gustaría buscar otra fecha?`;
      this.bookingProcessService.markInProgress(activeBooking);
    }

    return botReply;
  }

  private calculateNights(checkIn: string, checkOut: string): number {
    return daysBetween(parseDate(checkIn), parseDate(checkOut));
  }

  private async findAvailableRoom(checkIn: string, checkOut: string, capacity: number): Promise<Room | null> {
    const overlappingReservations = await this.reservationRepository.findOverlapping(parseDate(checkIn), parseDate(checkOut));
    const reservedRoomIds = overlappingReservations.map(r => r.room.id);

    const availableRooms = await this.roomRepository.findByCapacityExcluding(capacity, reservedRoomIds);

    return availableRooms.length > 0 ? availableRooms[0] : null;
  }

  /**
   * Busca fechas cercanas libres cuando las pedidas están ocupadas. Prioriza la cercanía por sobre
   * la cantidad exacta de noches: primero una estadía más corta que se superponga con lo pedido y
   * después bloques con las mismas noches corridos hasta ±7 días. Hace solo dos consultas (las
   * reservas de toda la ventana y las habitaciones candidatas) y resuelve el resto en memoria.
   */
  private async findAlternativeDates(checkIn: string, checkOut: string, capacity: number): Promise<AlternativeDates[]> {
    const requestedStart = parseDate(checkIn);
    const requestedNights = daysBetween(requestedStart, parseDate(checkOut));

    // Los índices de noche arrancan en windowStart, así que la fecha pedida cae siempre en el índice WINDOW_DAYS.
    const windowStart = addDays(requestedStart, -ALTERNATIVE_DATES_WINDOW_DAYS);
    const windowEnd = addDays(parseDate(checkOut), ALTERNATIVE_DATES_WINDOW_DAYS);
    const windowNights = daysBetween(windowStart, windowEnd);
    const requestedIndex = ALTERNATIVE_DATES_WINDOW_DAYS;

    const [rooms, reservations] = await Promise.all([
      this.roomRepository.findByCapacityExcluding(capacity, []),
      this.reservationRepository.findOverlapping(windowStart, windowEnd),
    ]);
    if (rooms.length === 0) return [];

    // Las noches anteriores a hoy no se pueden ofrecer: cuentan como ocupadas en todas las habitaciones.
    const firstBookableNight = daysBetween(windowStart, startOfToday());

    const freeNightsByRoom: RoomFreeNights[] = rooms.map((room) => {
      const free = Array.from({ length: windowNights }, (_, night) => night >= firstBookableNight);
      for (const reservation of reservations) {
        if (reservation.room.id !== room.id) continue;
        const from = Math.max(0, daysBetween(windowStart, toCalendarDay(reservation.checkIn)));
        const to = Math.min(windowNights, daysBetween(windowStart, toCalendarDay(reservation.checkOut)));
        for (let night = from; night < to; night++) free[night] = false;
      }
      return { room, free };
    });

    const fullStays = this.findFullStays(freeNightsByRoom, requestedIndex, requestedNights);
    const shorterStays = this.findShorterStays(freeNightsByRoom, requestedIndex, requestedNights);

    const ordered = [
      ...shorterStays.slice(0, MAX_SHORTER_ALTERNATIVES),
      ...fullStays,
      ...shorterStays.slice(MAX_SHORTER_ALTERNATIVES),
    ];

    const seen = new Set<string>();
    const alternatives: AlternativeDates[] = [];
    for (const block of ordered) {
      const key = `${block.start}:${block.nights}`;
      if (seen.has(key)) continue;
      seen.add(key);

      alternatives.push({
        checkIn: formatDate(addDays(windowStart, block.start)),
        checkOut: formatDate(addDays(windowStart, block.start + block.nights)),
        nights: block.nights,
        isShorterStay: block.nights < requestedNights,
        roomCategory: block.room.category.name,
        totalAmount: block.room.category.basePrice * block.nights,
      });
      if (alternatives.length === MAX_ALTERNATIVE_DATES) break;
    }

    return alternatives;
  }

  /** Bloques con las mismas noches pedidas, corridos de a un día (+1, −1, +2, −2, …) hasta el borde de la ventana. */
  private findFullStays(freeNightsByRoom: RoomFreeNights[], requestedIndex: number, requestedNights: number): CandidateBlock[] {
    const blocks: CandidateBlock[] = [];
    for (let distance = 1; distance <= ALTERNATIVE_DATES_WINDOW_DAYS; distance++) {
      for (const start of [requestedIndex + distance, requestedIndex - distance]) {
        const match = freeNightsByRoom.find(({ free }) => isRangeFree(free, start, requestedNights));
        if (match) blocks.push({ start, nights: requestedNights, room: match.room });
      }
    }
    return blocks;
  }

  /**
   * Tramos libres más cortos que lo pedido que se superponen con las fechas originales, así el
   * huésped conserva al menos parte de su viaje. Se ordenan por noches en común con lo pedido,
   * después por largo y después por cercanía del check-in.
   */
  private findShorterStays(freeNightsByRoom: RoomFreeNights[], requestedIndex: number, requestedNights: number): CandidateBlock[] {
    const maxNights = requestedNights - 1;
    const minNights = Math.max(MIN_SHORTER_STAY_NIGHTS, Math.ceil(requestedNights / 2));
    if (minNights > maxNights) return [];

    const requestedEnd = requestedIndex + requestedNights;
    const overlapWithRequest = (block: CandidateBlock) =>
      Math.min(block.start + block.nights, requestedEnd) - Math.max(block.start, requestedIndex);

    const candidates: CandidateBlock[] = [];
    for (const { room, free } of freeNightsByRoom) {
      let runStart = 0;
      while (runStart < free.length) {
        if (!free[runStart]) {
          runStart++;
          continue;
        }

        let runEnd = runStart;
        while (runEnd < free.length && free[runEnd]) runEnd++;
        const nights = Math.min(runEnd - runStart, maxNights);
        const start = Math.min(Math.max(requestedIndex, runStart), runEnd - nights);
        const block = { start, nights, room };
        if (nights >= minNights && overlapWithRequest(block) > 0) candidates.push(block);

        runStart = runEnd;
      }
    }

    return candidates.sort((a, b) =>
      overlapWithRequest(b) - overlapWithRequest(a)
      || b.nights - a.nights
      || Math.abs(a.start - requestedIndex) - Math.abs(b.start - requestedIndex),
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
  if (typeof value === 'string') {
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  const midday = new Date(value.getTime() + MS_PER_DAY / 2);
  return new Date(midday.getFullYear(), midday.getMonth(), midday.getDate());
}
