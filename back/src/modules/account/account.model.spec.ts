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
  DirectEntryType,
  getManualChargeError,
  getOpenAccountError,
  isManualChargeOrigin,
  manualChargeDescription,
  MAX_CHARGE_DETAIL_LENGTH,
  MAX_ENTRY_AMOUNT,
  MAX_ENTRY_DESCRIPTION_LENGTH,
  MAX_ENTRY_REFERENCE_LENGTH,
  MAX_TICKET_NUMBER_LENGTH,
  paymentDescription,
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
    paymentMethod: null,
    reference: null,
    operationId: null,
    reversesId: null,
    registeredAt: NOW,
    registeredById: null,
    registeredByName: null,
    ...overrides,
  });

const buildPayment = (overrides: Partial<AccountEntryProps> = {}) =>
  buildEntry({
    type: AccountEntryType.PAYMENT,
    description: 'Pago en efectivo',
    origin: AccountEntryOrigin.RECEPTION,
    sourceId: null,
    paymentMethod: PaymentMethod.CASH,
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
      // menos de un centavo: numeric(12,2) lo redondearía a 0
      [1e-9, /dos decimales/],
      [0.001, /dos decimales/],
    ])('rechaza el monto %s', (amount, message) => {
      expect(buildEntry({ amount }).getError()).toMatch(message);
    });

    it.each([[10.1], [0.01], [134217728.02], [MAX_ENTRY_AMOUNT]])(
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

  describe('pagos y reintegros (US-28)', () => {
    // cargos por 10.000: el huésped debe 10.000
    const owing = () =>
      buildAccount({ entries: [buildEntry({ amount: 10000 })] });

    it('acepta un pago parcial y uno que cancela el saldo', () => {
      expect(owing().getAmountError(AccountEntryType.PAYMENT, 4000)).toBeNull();
      expect(
        owing().getAmountError(AccountEntryType.PAYMENT, 10000),
      ).toBeNull();
    });

    it('rechaza un pago mayor al saldo pendiente y avisa cuánto se debe', () => {
      expect(
        owing().getAmountError(AccountEntryType.PAYMENT, 10000.01),
      ).toMatch(/supera el saldo pendiente \(\$10\.000,00\)/);
    });

    it('después de varios pagos parciales el saldo restante baja con cada uno', () => {
      const account = buildAccount({
        entries: [
          buildEntry({ amount: 10000 }),
          buildPayment({ amount: 4000 }),
          buildPayment({ amount: 2500.5, paymentMethod: PaymentMethod.CARD }),
        ],
      });

      expect(account.summary.balance).toBe(3499.5);
      expect(
        account.getAmountError(AccountEntryType.PAYMENT, 3499.5),
      ).toBeNull();
      expect(account.getAmountError(AccountEntryType.PAYMENT, 3499.51)).toMatch(
        /supera/,
      );
    });

    it.each([
      ['en cero', []],
      ['con saldo a favor', [buildPayment({ amount: 500 })]],
    ])('no acepta pagos con la cuenta %s', (_, entries) => {
      expect(
        buildAccount({ entries }).getAmountError(AccountEntryType.PAYMENT, 1),
      ).toMatch(/no tiene saldo pendiente/);
    });

    it('anular un pago vuelve a dejar ese monto como deuda', () => {
      const payment = buildPayment({ amount: 10000 });
      const reversal = AccountEntryModel.reversalOf(
        payment,
        'Se registró dos veces',
        RECEPTIONIST,
        NOW,
      );
      const account = buildAccount({
        entries: [buildEntry({ amount: 10000 }), payment, reversal],
      });

      expect(account.summary.balance).toBe(10000);
    });

    it('el reintegro devuelve hasta dejar el saldo a favor en cero', () => {
      // se pagaron 10.000 y después se anuló el cargo: el huésped tiene 10.000 a favor
      const charge = buildEntry({ amount: 10000 });
      const account = buildAccount({
        entries: [
          charge,
          buildPayment({ amount: 10000 }),
          AccountEntryModel.reversalOf(
            charge,
            'No correspondía',
            RECEPTIONIST,
            NOW,
          ),
        ],
      });

      expect(account.summary.balance).toBe(-10000);
      expect(account.getAmountError(AccountEntryType.REFUND, 6000)).toBeNull();
      expect(account.getAmountError(AccountEntryType.REFUND, 10000)).toBeNull();
      expect(account.getAmountError(AccountEntryType.REFUND, 10000.01)).toMatch(
        /supera el saldo a favor \(\$10\.000,00\)/,
      );
    });

    it.each([
      ['en cero', []],
      ['con deuda', [buildEntry({ amount: 100 })]],
    ])('no acepta reintegros con la cuenta %s', (_, entries) => {
      expect(
        buildAccount({ entries }).getAmountError(AccountEntryType.REFUND, 1),
      ).toMatch(/no tiene saldo a favor/);
    });

    it('a los cargos no les aplica el tope de saldo', () => {
      expect(
        buildAccount().getAmountError(AccountEntryType.CHARGE, 5000),
      ).toBeNull();
    });

    it.each([[AccountEntryType.PAYMENT], [AccountEntryType.REFUND]])(
      'un %s sin medio de pago es inválido',
      (type) => {
        expect(buildPayment({ type, paymentMethod: null }).getError()).toMatch(
          /medio de pago/,
        );
      },
    );

    it('un cargo no lleva medio de pago', () => {
      expect(
        buildEntry({ paymentMethod: PaymentMethod.CASH }).getError(),
      ).toMatch(/no lleva medio de pago/);
    });

    it('rechaza una referencia demasiado larga', () => {
      expect(
        buildPayment({
          reference: 'x'.repeat(MAX_ENTRY_REFERENCE_LENGTH + 1),
        }).getError(),
      ).toMatch(/referencia/);
    });

    it('guarda la referencia recortada y una vacía queda en null', () => {
      const create = (reference: string) =>
        AccountEntryModel.create(
          'account-1',
          {
            type: AccountEntryType.PAYMENT,
            amount: 100,
            description: paymentDescription(PaymentMethod.CARD),
            origin: AccountEntryOrigin.RECEPTION,
            paymentMethod: PaymentMethod.CARD,
            reference,
          },
          RECEPTIONIST,
          NOW,
        );

      expect(create('  cupón 123 ')).toMatchObject({
        reference: 'cupón 123',
        paymentMethod: PaymentMethod.CARD,
        description: 'Pago en tarjeta',
      });
      expect(create('   ').reference).toBeNull();
    });

    it('la anulación de un pago copia su medio y su referencia', () => {
      const payment = buildPayment({
        paymentMethod: PaymentMethod.TRANSFER,
        reference: 'op-77',
      });

      const reversal = AccountEntryModel.reversalOf(
        payment,
        'Error de carga',
        RECEPTIONIST,
        NOW,
      );

      expect(reversal).toMatchObject({
        type: AccountEntryType.PAYMENT_REVERSAL,
        paymentMethod: PaymentMethod.TRANSFER,
        reference: 'op-77',
      });
      expect(reversal.getError()).toBeNull();
    });
  });

  describe('reintentos con clave de operación', () => {
    it('encuentra el movimiento ya registrado con esa clave', () => {
      const payment = buildPayment({ operationId: 'op-1' });
      const account = buildAccount({ entries: [buildEntry(), payment] });

      expect(account.findByOperationId('op-1')).toBe(payment);
      expect(account.findByOperationId('op-2')).toBeUndefined();
      expect(account.findByOperationId(null)).toBeUndefined();
    });

    it('un reintento con el mismo tipo y monto es válido', () => {
      expect(
        buildPayment({ amount: 10.1 }).getRetryError({
          type: AccountEntryType.PAYMENT,
          amount: 10.1,
        }),
      ).toBeNull();
    });

    it.each([
      [AccountEntryType.PAYMENT, 2000],
      [AccountEntryType.REFUND, 1000],
    ] as [DirectEntryType, number][])(
      'la misma clave con otro pedido (%s por %s) es un error',
      (type, amount) => {
        expect(
          buildPayment({ amount: 1000 }).getRetryError({ type, amount }),
        ).toMatch(/ya se registró/);
      },
    );

    it('la anulación no hereda la clave del pago', () => {
      const reversal = AccountEntryModel.reversalOf(
        buildPayment({ operationId: 'op-1' }),
        'Error',
        RECEPTIONIST,
        NOW,
      );

      expect(reversal.operationId).toBeNull();
    });
  });

  describe('consumos cargados a mano (US-27)', () => {
    it.each([
      [
        AccountEntryOrigin.RESTAURANT,
        '1234',
        'Cena para 2',
        'Restó: ticket N° 1234 · Cena para 2',
      ],
      [AccountEntryOrigin.RESTAURANT, '1234', null, 'Restó: ticket N° 1234'],
      [AccountEntryOrigin.RESTAURANT, null, null, 'Restó: consumo'],
      [AccountEntryOrigin.RESTAURANT, '  ', '  ', 'Restó: consumo'],
      [
        AccountEntryOrigin.RECEPTION,
        null,
        'Lavandería',
        'Recepción: Lavandería',
      ],
      [
        AccountEntryOrigin.BAR,
        '88',
        '2 tragos',
        'Bar: ticket N° 88 · 2 tragos',
      ],
    ] as const)(
      '%s con ticket %s y detalle %s queda como "%s"',
      (origin, ticketNumber, detail, expected) => {
        expect(manualChargeDescription(origin, ticketNumber, detail)).toBe(
          expected,
        );
      },
    );

    it('con los topes de largo entra en la descripción de un movimiento', () => {
      const description = manualChargeDescription(
        AccountEntryOrigin.RECEPTION,
        'x'.repeat(MAX_TICKET_NUMBER_LENGTH),
        'y'.repeat(MAX_CHARGE_DETAIL_LENGTH),
      );

      expect(description.length).toBeLessThanOrEqual(
        MAX_ENTRY_DESCRIPTION_LENGTH,
      );
    });

    it('en recepción el detalle es obligatorio; en el restó y el bar no', () => {
      expect(getManualChargeError(AccountEntryOrigin.RECEPTION, '  ')).toMatch(
        /qué se está cobrando/,
      );
      expect(
        getManualChargeError(AccountEntryOrigin.RECEPTION, 'Frigobar'),
      ).toBeNull();
      expect(
        getManualChargeError(AccountEntryOrigin.RESTAURANT, null),
      ).toBeNull();
      expect(getManualChargeError(AccountEntryOrigin.BAR, null)).toBeNull();
    });

    it.each([
      [AccountEntryOrigin.RESTAURANT, true],
      [AccountEntryOrigin.RECEPTION, true],
      [AccountEntryOrigin.BAR, true],
      [AccountEntryOrigin.ROOM_SERVICE, false],
      [AccountEntryOrigin.SPA, false],
    ])('%s se carga a mano: %s', (origin, expected) => {
      expect(isManualChargeOrigin(origin)).toBe(expected);
    });
  });
});
