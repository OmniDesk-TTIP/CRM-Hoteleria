import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { PaymentMethod } from '../../infrastructure/database/entities/Account.entity';
import {
  AccountEntryOrigin,
  AccountEntryType,
} from '../../infrastructure/database/entities/AccountEntry.entity';
import {
  AccountEntryModel,
  AccountModel,
  EntryAuthor,
  getManualChargeError,
  getOpenAccountError,
  MANUAL_CHARGE_ORIGINS,
  manualChargeDescription,
  ManualChargeOrigin,
  NewEntryData,
  OPERATION_REUSED,
  paymentDescription,
} from './account.model';
import { AccountRepository } from './account.repository';
import {
  Consumption,
  planConsumptionEntries,
  planConsumptionsEntries,
} from './consumption.model';
import { ReservationAccountDto } from './dto/account.dto';

const NO_ACCOUNT = 'La reserva no tiene una cuenta abierta';

export interface PaymentData {
  /** Clave de idempotencia que genera el panel por cada pago confirmado. */
  operationId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  reference?: string | null;
}

/** US-27: consumo cargado a mano desde la cuenta (restó o recepción). */
export interface ChargeData {
  /** Clave de idempotencia que genera el panel por cada cargo confirmado. */
  operationId: string;
  origin: ManualChargeOrigin;
  amount: number;
  ticketNumber?: string | null;
  detail?: string | null;
}

export interface RefundData {
  /** Clave de idempotencia que genera el panel por cada reintegro confirmado. */
  operationId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  reason: string;
}

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

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

  /** US-27: si se le pueden cargar consumos (Chamber ofrece "Cargar a la habitación"). */
  hasOpenAccount(reservationId: string): Promise<boolean> {
    return this.accountRepository.hasOpenAccount(reservationId);
  }

  /** Registra el pago del resto de la estadía y abre la cuenta de la reserva. */
  async open(
    reservationId: string,
    paymentMethod: PaymentMethod,
    userId: string,
    now: Date = new Date(),
  ): Promise<ReservationAccountDto> {
    const inserted = await this.accountRepository.insert(
      reservationId,
      (reservation, consumptions) => {
        const error = getOpenAccountError(reservation);
        if (error) throw new ConflictException(error);
        const account = AccountModel.open(
          reservation,
          paymentMethod,
          userId,
          now,
        );
        // US-27: lo que el huésped ya consumió en la estadía entra con la apertura
        return {
          account,
          entries: planConsumptionsEntries(account, consumptions, now),
        };
      },
    );
    if (inserted === null) throw new NotFoundException('Reserva no encontrada');
    if (!inserted) {
      throw new ConflictException('La cuenta de esta reserva ya está abierta');
    }

    return this.getForReservation(reservationId);
  }

  /**
   * US-28: recepción registra un pago (total o parcial) y devuelve la cuenta con el saldo que
   * queda.
   */
  async registerPayment(
    reservationId: string,
    data: PaymentData,
    author: EntryAuthor,
    now: Date = new Date(),
  ): Promise<ReservationAccountDto> {
    await this.registerEntry(
      reservationId,
      {
        type: AccountEntryType.PAYMENT,
        amount: data.amount,
        description: paymentDescription(data.paymentMethod),
        origin: AccountEntryOrigin.RECEPTION,
        paymentMethod: data.paymentMethod,
        reference: data.reference,
        operationId: data.operationId,
      },
      author,
      now,
    );
    return this.getForReservation(reservationId);
  }

  /** US-28: devuelve al huésped su saldo a favor, sin pasarse de $0. */
  async registerRefund(
    reservationId: string,
    data: RefundData,
    author: EntryAuthor,
    now: Date = new Date(),
  ): Promise<ReservationAccountDto> {
    await this.registerEntry(
      reservationId,
      {
        type: AccountEntryType.REFUND,
        amount: data.amount,
        description: data.reason,
        origin: AccountEntryOrigin.RECEPTION,
        paymentMethod: data.paymentMethod,
        operationId: data.operationId,
      },
      author,
      now,
    );
    return this.getForReservation(reservationId);
  }

  /** US-28: anula un pago registrado por error; `reason` queda como descripción. */
  async reversePayment(
    reservationId: string,
    entryId: string,
    reason: string,
    author: EntryAuthor,
    now: Date = new Date(),
  ): Promise<ReservationAccountDto> {
    await this.appendReversal(
      reservationId,
      entryId,
      reason,
      author,
      now,
      AccountEntryType.PAYMENT,
    );
    return this.getForReservation(reservationId);
  }

  /**
   * US-27: pone la cuenta al día con un consumo (cargo, anulación si se canceló y pago si se pagó
   * con el link). Es idempotente y no genera nada si la reserva no tiene cuenta o está cerrada.
   * Nunca lanza: un problema con la cuenta no puede frenar el pedido del huésped. Lo que falte se
   * completa con el próximo evento del mismo consumo.
   */
  async syncConsumption(
    reservationId: string,
    consumption: Consumption | null,
    now: Date = new Date(),
  ): Promise<AccountEntryModel[]> {
    if (!consumption) return [];
    try {
      const entries = await this.accountRepository.syncConsumption(
        reservationId,
        (account) => planConsumptionEntries(account, consumption, now),
      );
      return entries ?? [];
    } catch (error) {
      this.logger.error(
        `No se pudo reflejar en la cuenta el consumo ${consumption.origin} ${consumption.sourceId}: ${String(error)}`,
      );
      return [];
    }
  }

  /**
   * Carga un cargo, un pago o un reintegro. Lo usan los módulos de consumos y recepción. Un pago
   * no puede superar el saldo pendiente ni un reintegro el saldo a favor.
   */
  async registerEntry(
    reservationId: string,
    data: NewEntryData,
    author: EntryAuthor,
    now: Date = new Date(),
  ): Promise<AccountEntryModel> {
    const entry = await this.accountRepository
      .appendEntry(reservationId, (account) => {
        // va primero: el reintento de un pago que canceló el saldo ya no pasaría el tope
        const retried = account.findByOperationId(data.operationId);
        if (retried) {
          const reused = retried.getRetryError(data);
          if (reused) throw new ConflictException(reused);
          return retried;
        }

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

        const exceeds = account.getAmountError(data.type, created.amount);
        if (exceeds) throw new BadRequestException(exceeds);
        return created;
      })
      .catch((error: unknown) => {
        // dentro de la cuenta el lock ya lo resuelve; esto es una clave usada en otra cuenta
        if (error instanceof UniqueConstraintViolationException) {
          throw new ConflictException(OPERATION_REUSED);
        }
        throw error;
      });
    if (!entry) throw new NotFoundException(NO_ACCOUNT);
    return entry;
  }

  /** Anula un cargo o un pago con un movimiento nuevo; `reason` queda como descripción. */
  reverseEntry(
    reservationId: string,
    entryId: string,
    reason: string,
    author: EntryAuthor,
    now: Date = new Date(),
  ): Promise<AccountEntryModel> {
    return this.appendReversal(reservationId, entryId, reason, author, now);
  }

  /** US-27: carga un consumo del restó o de recepción y devuelve la cuenta actualizada. */
  async registerCharge(
    reservationId: string,
    data: ChargeData,
    author: EntryAuthor,
    now: Date = new Date(),
  ): Promise<ReservationAccountDto> {
    const error = getManualChargeError(data.origin, data.detail);
    if (error) throw new BadRequestException(error);

    await this.registerEntry(
      reservationId,
      {
        type: AccountEntryType.CHARGE,
        amount: data.amount,
        description: manualChargeDescription(
          data.origin,
          data.ticketNumber,
          data.detail,
        ),
        origin: data.origin,
        operationId: data.operationId,
      },
      author,
      now,
    );
    return this.getForReservation(reservationId);
  }

  /**
   * US-27: anula un consumo cargado a mano por error; `reason` queda como descripción. Los cargos
   * de room service no: se anulan solos al cancelar el pedido.
   */
  async reverseCharge(
    reservationId: string,
    entryId: string,
    reason: string,
    author: EntryAuthor,
    now: Date = new Date(),
  ): Promise<ReservationAccountDto> {
    await this.appendReversal(
      reservationId,
      entryId,
      reason,
      author,
      now,
      AccountEntryType.CHARGE,
      MANUAL_CHARGE_ORIGINS,
    );
    return this.getForReservation(reservationId);
  }

  /**
   * `expectedType` limita qué se puede anular (por ejemplo, solo pagos) y `origins`, de dónde
   * puede venir el movimiento.
   */
  private async appendReversal(
    reservationId: string,
    entryId: string,
    reason: string,
    author: EntryAuthor,
    now: Date,
    expectedType?: AccountEntryType,
    origins?: readonly AccountEntryOrigin[],
  ): Promise<AccountEntryModel> {
    try {
      const reversal = await this.accountRepository.appendEntry(
        reservationId,
        (account) => {
          const original = account.findEntry(entryId);
          const matches =
            original &&
            (!expectedType || original.type === expectedType) &&
            (!origins || origins.includes(original.origin));
          if (!original || !matches) {
            throw new NotFoundException(
              origins
                ? 'El cargo no existe en esta cuenta o no se carga a mano (los de room service se anulan al cancelar el pedido)'
                : expectedType === AccountEntryType.PAYMENT
                  ? 'El pago no pertenece a esta cuenta'
                  : 'El movimiento no pertenece a esta cuenta',
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
