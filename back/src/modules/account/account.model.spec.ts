import {
  AccountStatus,
  PaymentMethod,
} from '../../infrastructure/database/entities/Account.entity';
import {
  AccountEntryOrigin,
  AccountEntryType,
} from '../../infrastructure/database/entities/AccountEntry.entity';
import { ReservationStatus } from '../../infrastructure/database/entities/Reservation.entity';
import {
  AccountEntryModel,
  AccountEntryProps,
  AccountModel,
  AccountProps,
  getOpenAccountError,
  MAX_ENTRY_AMOUNT,
  MAX_ENTRY_DESCRIPTION_LENGTH,
  stayBalanceOf,
  summarizeEntries,
} from './account.model';

const NOW = new Date(Date.UTC(2099, 2, 15, 15, 0));
const RECEPTIONIST = { userId: 'user-1', userName: 'Lucía Recepción' };
const CHAMBER = { userId: null };

let seq = 0;
const buildEntry = (overrides: Partial<AccountEntryProps> = {}) =>
  new AccountEntryModel({
    id: `entry-${++seq}`,
    accountId: 'account-1',
    type: AccountEntryType.CHARGE,
    amount: 1000,
    description: 'Room service: 2 cafés',
    origin: AccountEntryOrigin.ROOM_SERVICE,
    sourceId: 'order-1',
    reversesId: null,
    registeredAt: NOW,
    registeredById: null,
    registeredByName: null,
    ...overrides,
  });

const buildAccount = (overrides: Partial<AccountProps> = {}) =>
  new AccountModel({
    id: 'account-1',
    reservationId: 'reservation-1',
    status: AccountStatus.OPEN,
    stayBalanceAmount: 70000,
    stayBalancePaymentMethod: PaymentMethod.CASH,
    openedById: 'user-1',
    openedByName: 'Lucía Recepción',
    openedAt: NOW,
    closedAt: null,
    entries: [],
    ...overrides,
  });

describe('AccountModel', () => {
  describe('apertura', () => {
    it('abre la cuenta con el resto de la estadía calculado desde la reserva', () => {
      const account = AccountModel.open(
        {
          id: 'reservation-1',
          status: ReservationStatus.CONFIRMED,
          totalAmount: 100000,
          depositAmount: 30000,
        },
        PaymentMethod.CARD,
        'user-1',
        NOW,
      );

      expect(account).toMatchObject({
        reservationId: 'reservation-1',
        status: AccountStatus.OPEN,
        stayBalanceAmount: 70000,
        stayBalancePaymentMethod: PaymentMethod.CARD,
        openedById: 'user-1',
        openedAt: NOW,
        closedAt: null,
        entries: [],
      });
      expect(account.summary.balance).toBe(0);
    });

    it.each([
      [ReservationStatus.PENDING_PAYMENT],
      [ReservationStatus.CANCELLED],
      [ReservationStatus.EXPIRED],
    ])('no se abre la cuenta de una reserva %s', (status) => {
      expect(getOpenAccountError({ status })).toMatch(/confirmada/);
    });

    it('se abre la cuenta de una reserva confirmada', () => {
      expect(
        getOpenAccountError({ status: ReservationStatus.CONFIRMED }),
      ).toBeNull();
    });

    it.each([
      [100000, 30000, 70000],
      [100000.5, 30000.25, 70000.25],
      // una seña mayor al total (carga manual) no deja un resto negativo
      [10000, 12000, 0],
    ])(
      'el resto de una estadía de %s con seña de %s es %s',
      (totalAmount, depositAmount, expected) => {
        expect(stayBalanceOf({ totalAmount, depositAmount })).toBe(expected);
      },
    );
  });

  describe('saldo', () => {
    it('sin movimientos el saldo es cero', () => {
      expect(summarizeEntries([])).toEqual({
        totalCharges: 0,
        totalPayments: 0,
        balance: 0,
      });
    });

    it('cargos menos pagos: positivo es lo que debe el huésped', () => {
      const summary = summarizeEntries([
        buildEntry({ type: AccountEntryType.CHARGE, amount: 5000 }),
        buildEntry({ type: AccountEntryType.CHARGE, amount: 2500 }),
        buildEntry({ type: AccountEntryType.PAYMENT, amount: 3000 }),
      ]);

      expect(summary).toEqual({
        totalCharges: 7500,
        totalPayments: 3000,
        balance: 4500,
      });
    });

    it('las anulaciones descuentan del lado que anulan y el reintegro vuelve a sumar', () => {
      const summary = summarizeEntries([
        buildEntry({ type: AccountEntryType.CHARGE, amount: 5000 }),
        buildEntry({ type: AccountEntryType.CHARGE_REVERSAL, amount: 5000 }),
        buildEntry({ type: AccountEntryType.CHARGE, amount: 2000 }),
        buildEntry({ type: AccountEntryType.PAYMENT, amount: 4000 }),
        buildEntry({ type: AccountEntryType.PAYMENT_REVERSAL, amount: 1000 }),
        buildEntry({ type: AccountEntryType.REFUND, amount: 500 }),
      ]);

      expect(summary).toEqual({
        totalCharges: 2000,
        totalPayments: 2500,
        balance: -500,
      });
    });

    it('suma centavos sin errores de redondeo', () => {
      const summary = summarizeEntries([
        buildEntry({ type: AccountEntryType.CHARGE, amount: 0.1 }),
        buildEntry({ type: AccountEntryType.CHARGE, amount: 0.2 }),
      ]);

      expect(summary.totalCharges).toBe(0.3);
      expect(summary.balance).toBe(0.3);
    });
  });

  describe('movimientos nuevos', () => {
    it('una cuenta abierta acepta movimientos', () => {
      expect(buildAccount().getNewEntryError()).toBeNull();
    });

    it('una cuenta cerrada no acepta movimientos nuevos', () => {
      expect(
        buildAccount({ status: AccountStatus.CLOSED }).getNewEntryError(),
      ).toMatch(/cerrada/);
    });

    it('guarda quién lo registró; sin usuario es Chamber', () => {
      const byUser = AccountEntryModel.create(
        'account-1',
        {
          type: AccountEntryType.CHARGE,
          amount: 1500,
          description: 'Lavandería',
          origin: AccountEntryOrigin.RECEPTION,
        },
        RECEPTIONIST,
        NOW,
      );
      const byBot = AccountEntryModel.create(
        'account-1',
        {
          type: AccountEntryType.CHARGE,
          amount: 1500,
          description: 'Masaje',
          origin: AccountEntryOrigin.SPA,
          sourceId: 'spa-1',
        },
        CHAMBER,
        NOW,
      );

      expect(byUser).toMatchObject({
        registeredById: 'user-1',
        sourceId: null,
        reversesId: null,
        registeredAt: NOW,
      });
      expect(byBot).toMatchObject({ registeredById: null, sourceId: 'spa-1' });
    });

    it.each([
      [0, /mayor a cero/],
      [-100, /mayor a cero/],
      [Number.NaN, /mayor a cero/],
      [MAX_ENTRY_AMOUNT + 1, /demasiado grande/],
      [10.123, /dos decimales/],
    ])('rechaza el monto %s', (amount, message) => {
      expect(buildEntry({ amount }).getError()).toMatch(message);
    });

    it.each([[10.1], [0.01], [MAX_ENTRY_AMOUNT]])(
      'acepta el monto %s',
      (amount) => {
        expect(buildEntry({ amount }).getError()).toBeNull();
      },
    );

    it.each([
      ['', /vacía/],
      ['   ', /vacía/],
      ['x'.repeat(MAX_ENTRY_DESCRIPTION_LENGTH + 1), /superar/],
    ])('rechaza la descripción "%s"', (description, message) => {
      expect(buildEntry({ description }).getError()).toMatch(message);
    });
  });

  describe('anulaciones', () => {
    it.each([
      [AccountEntryType.CHARGE, AccountEntryType.CHARGE_REVERSAL],
      [AccountEntryType.PAYMENT, AccountEntryType.PAYMENT_REVERSAL],
    ])(
      'un %s se anula con un %s que copia monto, origen y referencia',
      (type, reversalType) => {
        const original = buildEntry({
          type,
          amount: 3200,
          sourceId: 'order-9',
        });

        const reversal = AccountEntryModel.reversalOf(
          original,
          'Se cargó dos veces',
          RECEPTIONIST,
          NOW,
        );

        expect(reversal).toMatchObject({
          type: reversalType,
          amount: 3200,
          origin: original.origin,
          sourceId: 'order-9',
          reversesId: original.id,
          description: 'Se cargó dos veces',
          registeredById: 'user-1',
        });
        expect(reversal.id).not.toBe(original.id);
      },
    );

    it('un movimiento no se puede anular dos veces', () => {
      const charge = buildEntry();
      const reversal = AccountEntryModel.reversalOf(
        charge,
        'Error',
        RECEPTIONIST,
        NOW,
      );
      const account = buildAccount({ entries: [charge, reversal] });

      expect(account.reversedEntryIds).toEqual(new Set([charge.id]));
      expect(account.getReversalError(charge.id)).toMatch(/ya fue anulado/);
    });

    it.each([
      [AccountEntryType.CHARGE_REVERSAL],
      [AccountEntryType.PAYMENT_REVERSAL],
      [AccountEntryType.REFUND],
    ])('un %s no se puede anular', (type) => {
      const entry = buildEntry({ type });
      const account = buildAccount({ entries: [entry] });

      expect(account.getReversalError(entry.id)).toMatch(/cargos y pagos/);
      expect(() =>
        AccountEntryModel.reversalOf(entry, 'Error', RECEPTIONIST, NOW),
      ).toThrow();
    });

    it('no anula un movimiento de otra cuenta', () => {
      expect(buildAccount().getReversalError('otro')).toMatch(/no pertenece/);
    });

    it('no anula en una cuenta cerrada', () => {
      const charge = buildEntry();
      const account = buildAccount({
        status: AccountStatus.CLOSED,
        entries: [charge],
      });

      expect(account.getReversalError(charge.id)).toMatch(/cerrada/);
    });

    it('un cargo sin anular se puede anular', () => {
      const charge = buildEntry();

      expect(
        buildAccount({ entries: [charge] }).getReversalError(charge.id),
      ).toBeNull();
    });
  });
});
