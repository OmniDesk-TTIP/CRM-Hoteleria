import { Injectable } from '@nestjs/common';
import { BookingProcess, BookingProcessStep } from '../../infrastructure/database/entities/BookingProcess.entity';
import { SearchAvailabilityDto } from './dto/searchAvailability.dto';
import { BookingProcessRepository } from './bookingProcess.repository';

@Injectable()
export class BookingProcessService {
  constructor(private readonly bookingProcessRepository: BookingProcessRepository) {}

  async getActive(telegramUserId: string): Promise<BookingProcess | null> {
    return this.bookingProcessRepository.findActive(telegramUserId);
  }

  async getLastCompleted(telegramUserId: string): Promise<BookingProcess | null> {
    return this.bookingProcessRepository.findLastCompleted(telegramUserId);
  }

  startSearch(telegramUserId: string, activeBooking: BookingProcess | null, { checkIn, checkOut, capacity }: SearchAvailabilityDto): BookingProcess {
    const booking = activeBooking || this.bookingProcessRepository.create(telegramUserId);
    booking.checkIn = checkIn;
    booking.checkOut = checkOut;
    booking.capacity = capacity;

    return booking;
  }

  markPendingConfirmation(booking: BookingProcess): void {
    booking.step = BookingProcessStep.PENDING_CONFIRMATION;
    this.bookingProcessRepository.persist(booking);
  }

  markInProgress(booking: BookingProcess): void {
    booking.step = BookingProcessStep.IN_PROGRESS;
    this.bookingProcessRepository.persist(booking);
  }

  markCompleted(booking: BookingProcess): void {
    booking.step = BookingProcessStep.COMPLETED;
    this.bookingProcessRepository.persist(booking);
  }
}
