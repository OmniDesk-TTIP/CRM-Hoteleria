import { Injectable } from '@nestjs/common';
import {
  EntityManager,
  LockMode,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';
import { Account } from '../../infrastructure/database/entities/Account.entity';
import { AccountEntry } from '../../infrastructure/database/entities/AccountEntry.entity';
import { Reservation } from '../../infrastructure/database/entities/Reservation.entity';
import { User } from '../../infrastructure/database/entities/User.entity';
import { toDateKey } from '../../common/date.util';
import {
  AccountEntryModel,
  AccountModel,
  AccountReservationInfo,
} from './account.model';

@Injectable()
export class AccountRepository {
  constructor(private readonly em: EntityManager) {}

  async findReservation(
    reservationId: string,
  ): Promise<AccountReservationInfo | null> {
    const reservation = await this.em.findOne(
      Reservation,
      { id: reservationId },
      { populate: ['room', 'room.category'], refresh: true },
    );
    if (!reservation) return null;

    return {
      id: reservation.id,
      status: reservation.status,
      // decimal llega como string desde pg.
      totalAmount: Number(reservation.totalAmount),
      depositAmount: Number(reservation.depositAmount),
      guestFullName: reservation.guestFullName,
      guestDni: reservation.guestDni,
      roomNumber: reservation.room.roomNumber,
      categoryName: reservation.room.category?.name ?? '',
      checkIn: toDateKey(reservation.checkIn),
      checkOut: toDateKey(reservation.checkOut),
    };
  }

  async findByReservationId(
    reservationId: string,
  ): Promise<AccountModel | null> {
    return this.loadAccount(this.em, reservationId);
  }

  /** Devuelve false si la reserva ya tenía cuenta (la FK única lo frena aunque sea simultáneo). */
  async insert(model: AccountModel): Promise<boolean> {
    try {
      await this.em.transactional((em) => {
        em.persist(
          em.create(Account, {
            id: model.id,
            reservation: em.getReference(Reservation, model.reservationId),
            status: model.status,
            stayBalanceAmount: model.stayBalanceAmount,
            stayBalancePaymentMethod: model.stayBalancePaymentMethod,
            openedBy: em.getReference(User, model.openedById),
            openedAt: model.openedAt,
            closedAt: model.closedAt,
          }),
        );
      });
      return true;
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) return false;
      throw error;
    }
  }

  /**
   * Agrega un movimiento con la cuenta bloqueada. Leer los movimientos, decidir y guardar es una
   * sola operación: sin el lock, dos usuarios podrían anular el mismo cargo o cargar en una
   * cuenta que se está cerrando. `build` decide con la cuenta al día y puede lanzar para abortar.
   * Devuelve null si la reserva no tiene cuenta.
   */
  async appendEntry(
    reservationId: string,
    build: (account: AccountModel) => AccountEntryModel,
  ): Promise<AccountEntryModel | null> {
    return this.em.transactional(async (em) => {
      const locked = await em.findOne(
        Account,
        { reservation: reservationId },
        { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
      );
      if (!locked) return null;

      const account = await this.loadAccount(em, reservationId);
      if (!account) return null;

      const entry = build(account);
      em.persist(
        em.create(AccountEntry, {
          id: entry.id,
          account: em.getReference(Account, entry.accountId),
          type: entry.type,
          amount: entry.amount,
          description: entry.description,
          origin: entry.origin,
          sourceId: entry.sourceId,
          paymentMethod: entry.paymentMethod,
          reference: entry.reference,
          reverses: entry.reversesId
            ? em.getReference(AccountEntry, entry.reversesId)
            : null,
          registeredAt: entry.registeredAt,
          registeredBy: entry.registeredById
            ? em.getReference(User, entry.registeredById)
            : null,
        }),
      );
      return entry;
    });
  }

  private async loadAccount(
    em: EntityManager,
    reservationId: string,
  ): Promise<AccountModel | null> {
    const account = await em.findOne(
      Account,
      { reservation: reservationId },
      { populate: ['openedBy'], refresh: true },
    );
    if (!account) return null;

    const entries = await em.find(
      AccountEntry,
      { account: account.id },
      {
        populate: ['registeredBy'],
        orderBy: { registeredAt: 'asc', id: 'asc' },
        refresh: true,
      },
    );

    return new AccountModel({
      id: account.id,
      reservationId,
      status: account.status,
      stayBalanceAmount: Number(account.stayBalanceAmount),
      stayBalancePaymentMethod: account.stayBalancePaymentMethod,
      openedById: account.openedBy.id,
      openedByName: account.openedBy.fullName,
      openedAt: account.openedAt,
      closedAt: account.closedAt ?? null,
      entries: entries.map((entry) => this.toEntryModel(entry, account.id)),
    });
  }

  private toEntryModel(entity: AccountEntry, accountId: string) {
    return new AccountEntryModel({
      id: entity.id,
      accountId,
      type: entity.type,
      amount: Number(entity.amount),
      description: entity.description,
      origin: entity.origin,
      sourceId: entity.sourceId ?? null,
      paymentMethod: entity.paymentMethod ?? null,
      reference: entity.reference ?? null,
      reversesId: entity.reverses?.id ?? null,
      registeredAt: entity.registeredAt,
      registeredById: entity.registeredBy?.id ?? null,
      registeredByName: entity.registeredBy?.fullName ?? null,
    });
  }
}
