import { Injectable } from '@nestjs/common';
import {
  EntityManager,
  LockMode,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';
import {
  Account,
  AccountStatus,
} from '../../infrastructure/database/entities/Account.entity';
import { AccountEntry } from '../../infrastructure/database/entities/AccountEntry.entity';
import { Reservation } from '../../infrastructure/database/entities/Reservation.entity';
import {
  RoomServiceOrder,
  RoomServiceOrderStatus,
} from '../../infrastructure/database/entities/RoomServiceOrder.entity';
import { User } from '../../infrastructure/database/entities/User.entity';
import { toDateKey } from '../../common/date.util';
import {
  AccountEntryModel,
  AccountModel,
  AccountReservationInfo,
  ReservationForAccount,
} from './account.model';
import { Consumption, roomServiceConsumption } from './consumption.model';

/** Lo que se guarda al abrir la cuenta: la cuenta y los consumos previos de la estadía. */
export interface OpenedAccount {
  account: AccountModel;
  entries: AccountEntryModel[];
}

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

  async hasOpenAccount(reservationId: string): Promise<boolean> {
    const count = await this.em.count(Account, {
      reservation: reservationId,
      status: AccountStatus.OPEN,
    });
    return count > 0;
  }

  async findByReservationId(
    reservationId: string,
  ): Promise<AccountModel | null> {
    return this.loadAccount(this.em, reservationId);
  }

  /**
   * Abre la cuenta con la reserva bloqueada: `build` valida el estado y calcula el importe con esa
   * lectura, así una cancelación que terminó antes impide la apertura y una que llega después
   * espera. Devuelve null si la reserva no existe y false si ya tenía cuenta (la FK única lo frena
   * aunque sea simultáneo).
   */
  async insert(
    reservationId: string,
    build: (
      reservation: ReservationForAccount,
      consumptions: Consumption[],
    ) => OpenedAccount,
  ): Promise<boolean | null> {
    try {
      return await this.em.transactional(async (em) => {
        const reservation = await em.findOne(
          Reservation,
          { id: reservationId },
          { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
        );
        if (!reservation) return null;

        const { account: model, entries } = build(
          {
            id: reservation.id,
            status: reservation.status,
            totalAmount: Number(reservation.totalAmount),
            depositAmount: Number(reservation.depositAmount),
          },
          await this.findConsumptions(em, reservationId),
        );
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
        entries.forEach((entry) => this.persistEntry(em, entry));
        return true;
      });
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) return false;
      throw error;
    }
  }

  /**
   * Agrega un movimiento con la cuenta bloqueada. Leer los movimientos, decidir y guardar es una
   * sola operación: sin el lock, dos usuarios podrían anular el mismo cargo o cargar en una
   * cuenta que se está cerrando. `build` decide con la cuenta al día y puede lanzar para abortar.
   * Si `build` devuelve un movimiento que la cuenta ya tiene (un reintento), no se guarda de nuevo.
   * Devuelve null si la reserva no tiene cuenta.
   */
  async appendEntry(
    reservationId: string,
    build: (account: AccountModel) => AccountEntryModel,
  ): Promise<AccountEntryModel | null> {
    const entries = await this.appendEntries(reservationId, (account) => [
      build(account),
    ]);
    return entries?.[0] ?? null;
  }

  /**
   * Pone la cuenta al día con un consumo (pedido de room service, etc.). Bloquea primero la
   * reserva y después la cuenta, en el mismo orden que la apertura: si la cuenta se está abriendo
   * en ese momento, espera y la encuentra; si no, la apertura ya ve el pedido y lo trae ella.
   * Devuelve los movimientos nuevos, o null si la reserva no tiene cuenta.
   */
  async syncConsumption(
    reservationId: string,
    build: (account: AccountModel) => AccountEntryModel[],
  ): Promise<AccountEntryModel[] | null> {
    return this.em.transactional(async (em) => {
      await em.findOne(
        Reservation,
        { id: reservationId },
        { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
      );
      return this.appendLocked(em, reservationId, build);
    });
  }

  async appendEntries(
    reservationId: string,
    build: (account: AccountModel) => AccountEntryModel[],
  ): Promise<AccountEntryModel[] | null> {
    return this.em.transactional((em) =>
      this.appendLocked(em, reservationId, build),
    );
  }

  private async appendLocked(
    em: EntityManager,
    reservationId: string,
    build: (account: AccountModel) => AccountEntryModel[],
  ): Promise<AccountEntryModel[] | null> {
    const locked = await em.findOne(
      Account,
      { reservation: reservationId },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    );
    if (!locked) return null;

    const account = await this.loadAccount(em, reservationId);
    if (!account) return null;

    const entries = build(account);
    entries
      .filter((entry) => !account.findEntry(entry.id))
      .forEach((entry) => this.persistEntry(em, entry));
    return entries;
  }

  private persistEntry(em: EntityManager, entry: AccountEntryModel): void {
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
        operationId: entry.operationId,
        reverses: entry.reversesId
          ? em.getReference(AccountEntry, entry.reversesId)
          : null,
        registeredAt: entry.registeredAt,
        registeredBy: entry.registeredById
          ? em.getReference(User, entry.registeredById)
          : null,
      }),
    );
  }

  /** Consumos de la estadía que todavía no están en la cuenta (los borradores no cuentan). */
  private async findConsumptions(
    em: EntityManager,
    reservationId: string,
  ): Promise<Consumption[]> {
    const orders = await em.find(
      RoomServiceOrder,
      {
        roomReservation: reservationId,
        status: { $ne: RoomServiceOrderStatus.PENDING_CONFIRMATION },
      },
      { orderBy: { confirmedAt: 'asc', id: 'asc' }, refresh: true },
    );
    return orders
      .map((order) =>
        roomServiceConsumption({
          id: order.id,
          status: order.status,
          paymentStatus: order.paymentStatus,
          items: order.items,
          total: Number(order.total),
          mpPaymentId: order.mpPaymentId ?? null,
        }),
      )
      .filter(
        (consumption): consumption is Consumption => consumption !== null,
      );
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
      operationId: entity.operationId ?? null,
      reversesId: entity.reverses?.id ?? null,
      registeredAt: entity.registeredAt,
      registeredById: entity.registeredBy?.id ?? null,
      registeredByName: entity.registeredBy?.fullName ?? null,
    });
  }
}
