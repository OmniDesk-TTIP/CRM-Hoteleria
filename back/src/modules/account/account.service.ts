import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { PaymentMethod } from '../../infrastructure/database/entities/Account.entity';
import {
  AccountEntryModel,
  AccountModel,
  EntryAuthor,
  getOpenAccountError,
  NewEntryData,
} from './account.model';
import { AccountRepository } from './account.repository';
import { ReservationAccountDto } from './dto/account.dto';

const NO_ACCOUNT = 'La reserva no tiene una cuenta abierta';

@Injectable()
export class AccountService {
  constructor(private readonly accountRepository: AccountRepository) {}

  async getForReservation(
    reservationId: string,
  ): Promise<ReservationAccountDto> {
    const reservation =
      await this.accountRepository.findReservation(reservationId);
    if (!reservation) throw new NotFoundException('Reserva no encontrada');

    const account =
      await this.accountRepository.findByReservationId(reservationId);
    return ReservationAccountDto.from(reservation, account);
  }

  /** Registra el pago del resto de la estadía y abre la cuenta de la reserva. */
  async open(
    reservationId: string,
    paymentMethod: PaymentMethod,
    userId: string,
    now: Date = new Date(),
  ): Promise<ReservationAccountDto> {
    const reservation =
      await this.accountRepository.findReservation(reservationId);
    if (!reservation) throw new NotFoundException('Reserva no encontrada');

    const error = getOpenAccountError(reservation);
    if (error) throw new ConflictException(error);

    const account = AccountModel.open(reservation, paymentMethod, userId, now);
    const inserted = await this.accountRepository.insert(account);
    if (!inserted) {
      throw new ConflictException('La cuenta de esta reserva ya está abierta');
    }

    return this.getForReservation(reservationId);
  }

  /** Carga un cargo, un pago o un reintegro. Lo usan los módulos de consumos y recepción. */
  async registerEntry(
    reservationId: string,
    data: NewEntryData,
    author: EntryAuthor,
    now: Date = new Date(),
  ): Promise<AccountEntryModel> {
    const entry = await this.accountRepository.appendEntry(
      reservationId,
      (account) => {
        const closed = account.getNewEntryError();
        if (closed) throw new ConflictException(closed);

        const created = AccountEntryModel.create(
          account.id,
          { ...data, description: data.description.trim() },
          author,
          now,
        );
        const invalid = created.getError();
        if (invalid) throw new BadRequestException(invalid);
        return created;
      },
    );
    if (!entry) throw new NotFoundException(NO_ACCOUNT);
    return entry;
  }

  /** Anula un cargo o un pago con un movimiento nuevo; `reason` queda como descripción. */
  async reverseEntry(
    reservationId: string,
    entryId: string,
    reason: string,
    author: EntryAuthor,
    now: Date = new Date(),
  ): Promise<AccountEntryModel> {
    try {
      const reversal = await this.accountRepository.appendEntry(
        reservationId,
        (account) => {
          const original = account.findEntry(entryId);
          if (!original) {
            throw new NotFoundException(
              'El movimiento no pertenece a esta cuenta',
            );
          }
          const error = account.getReversalError(entryId);
          if (error) throw new ConflictException(error);

          const created = AccountEntryModel.reversalOf(
            original,
            reason.trim(),
            author,
            now,
          );
          const invalid = created.getError();
          if (invalid) throw new BadRequestException(invalid);
          return created;
        },
      );
      if (!reversal) throw new NotFoundException(NO_ACCOUNT);
      return reversal;
    } catch (error) {
      // el lock ya lo evita; la FK única es la red por si alguien escribe sin pasar por acá
      if (error instanceof UniqueConstraintViolationException) {
        throw new ConflictException('El movimiento ya fue anulado');
      }
      throw error;
    }
  }
}
