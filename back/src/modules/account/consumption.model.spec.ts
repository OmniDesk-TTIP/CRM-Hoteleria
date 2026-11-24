import {
  AccountStatus,
  PaymentMethod,
} from '../../infrastructure/database/entities/Account.entity';
import {
  AccountEntryOrigin,
  AccountEntryType,
} from '../../infrastructure/database/entities/AccountEntry.entity';
import {
  RoomServiceOrderStatus,
  RoomServicePaymentStatus,
} from '../../infrastructure/database/entities/RoomServiceOrder.entity';
import {
  AccountEntryModel,
  AccountModel,
  AccountProps,
  MAX_ENTRY_DESCRIPTION_LENGTH,
} from './account.model';
import {
  CANCELLED_CONSUMPTION_REASON,
  Consumption,
  consumptionOperationId,
  planConsumptionEntries,
  planConsumptionsEntries,
  roomServiceConsumption,
  RoomServiceOrderSnapshot,
} from './consumption.model';

const NOW = new Date(Date.UTC(2099, 2, 15, 15, 0));

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

const buildConsumption = (
  overrides: Partial<Consumption> = {},
): Consumption => ({
  origin: AccountEntryOrigin.ROOM_SERVICE,
  sourceId: 'order-1',
  description: 'Room service: 2 x Café',
  amount: 3000,
  active: true,
  payment: null,
  ...overrides,
});

const buildOrder = (
  overrides: Partial<RoomServiceOrderSnapshot> = {},
): RoomServiceOrderSnapshot => ({
  id: 'order-1',
  status: RoomServiceOrderStatus.RECEIVED,
  paymentStatus: RoomServicePaymentStatus.PENDING,
  items: [
    { name: 'Café', quantity: 2 },
    { name: 'Medialuna', quantity: 3 },
  ],
  total: 7500,
  mpPaymentId: null,
  ...overrides,
});

/** Aplica lo planeado sobre la cuenta, como lo haría el repository. */
const apply = (account: AccountModel, entries: AccountEntryModel[]) =>
  new AccountModel({ ...account, entries: [...account.entries, ...entries] });

describe('Consumos en la cuenta (US-27)', () => {
  describe('roomServiceConsumption', () => {
    it('un pedido recibido es un consumo activo con el detalle y el total', () => {
      expect(roomServiceConsumption(buildOrder())).toEqual({
        origin: AccountEntryOrigin.ROOM_SERVICE,
        sourceId: 'order-1',
        description: 'Room service: 2 x Café, 3 x Medialuna',
        amount: 7500,
        active: true,
        payment: null,
      });
    });

    it('un borrador todavía no es un consumo', () => {
      expect(
        roomServiceConsumption(
          buildOrder({ status: RoomServiceOrderStatus.PENDING_CONFIRMATION }),
        ),
      ).toBeNull();
    });

    it.each([
      [RoomServiceOrderStatus.RECEIVED, true],
      [RoomServiceOrderStatus.IN_PREPARATION, true],
      [RoomServiceOrderStatus.DELIVERED, true],
      [RoomServiceOrderStatus.CANCELLED, false],
    ])('un pedido %s queda activo: %s', (status, active) => {
      expect(roomServiceConsumption(buildOrder({ status }))?.active).toBe(
        active,
      );
    });

    it('un pedido pagado con el link lleva el id del pago', () => {
      expect(
        roomServiceConsumption(
          buildOrder({
            paymentStatus: RoomServicePaymentStatus.PAID,
            mpPaymentId: 'mp-123',
          }),
        )?.payment,
      ).toEqual({ reference: 'mp-123' });
    });

    it('recorta un detalle demasiado largo', () => {
      const items = Array.from({ length: 30 }, (_, index) => ({
        name: `Plato muy largo número ${index}`,
        quantity: 1,
      }));

      const description = roomServiceConsumption(
        buildOrder({ items }),
      )!.description;

      expect(description.length).toBe(MAX_ENTRY_DESCRIPTION_LENGTH);
      expect(description.endsWith('…')).toBe(true);
    });
  });

  describe('planConsumptionEntries', () => {
    it('un consumo activo genera el cargo, registrado por Chamber', () => {
      const [charge, ...rest] = planConsumptionEntries(
        buildAccount(),
        buildConsumption(),
        NOW,
      );

      expect(rest).toHaveLength(0);
      expect(charge).toMatchObject({
        type: AccountEntryType.CHARGE,
        amount: 3000,
        description: 'Room service: 2 x Café',
        origin: AccountEntryOrigin.ROOM_SERVICE,
        sourceId: 'order-1',
        registeredById: null,
        operationId: consumptionOperationId(
          buildConsumption(),
          AccountEntryType.CHARGE,
        ),
      });
    });

    it('el mismo consumo dos veces no genera un segundo cargo', () => {
      const account = buildAccount();
      const first = planConsumptionEntries(account, buildConsumption(), NOW);

      expect(
        planConsumptionEntries(apply(account, first), buildConsumption(), NOW),
      ).toEqual([]);
    });

    it('al cancelarse anula el cargo una sola vez', () => {
      let account = buildAccount();
      account = apply(
        account,
        planConsumptionEntries(account, buildConsumption(), NOW),
      );
      const cancelled = buildConsumption({ active: false });

      const [reversal] = planConsumptionEntries(account, cancelled, NOW);
      account = apply(account, [reversal]);

      expect(reversal).toMatchObject({
        type: AccountEntryType.CHARGE_REVERSAL,
        amount: 3000,
        description: CANCELLED_CONSUMPTION_REASON,
        registeredById: null,
      });
      expect(planConsumptionEntries(account, cancelled, NOW)).toEqual([]);
      expect(account.summary.balance).toBe(0);
    });

    it('un pago con el link se registra una vez, sin tope de saldo', () => {
      let account = buildAccount();
      account = apply(
        account,
        planConsumptionEntries(account, buildConsumption(), NOW),
      );
      // recepción ya cobró todo antes de que llegue el webhook
      account = apply(account, [
        AccountEntryModel.create(
          account.id,
          {
            type: AccountEntryType.PAYMENT,
            amount: 3000,
            description: 'Pago en efectivo',
            origin: AccountEntryOrigin.RECEPTION,
            paymentMethod: PaymentMethod.CASH,
          },
          { userId: 'user-1' },
          NOW,
        ),
      ]);
      const paid = buildConsumption({ payment: { reference: 'mp-1' } });

      const [payment] = planConsumptionEntries(account, paid, NOW);
      account = apply(account, [payment]);

      expect(payment).toMatchObject({
        type: AccountEntryType.PAYMENT,
        amount: 3000,
        paymentMethod: PaymentMethod.MERCADO_PAGO,
        reference: 'mp-1',
        sourceId: 'order-1',
      });
      expect(payment.getError()).toBeNull();
      expect(planConsumptionEntries(account, paid, NOW)).toEqual([]);
      expect(account.summary.balance).toBe(-3000);
    });

    it('pagado y después cancelado: anula el cargo y deja el pago como saldo a favor', () => {
      let account = buildAccount();
      account = apply(
        account,
        planConsumptionEntries(
          account,
          buildConsumption({ payment: { reference: 'mp-1' } }),
          NOW,
        ),
      );

      account = apply(
        account,
        planConsumptionEntries(
          account,
          buildConsumption({ active: false, payment: { reference: 'mp-1' } }),
          NOW,
        ),
      );

      expect(account.entries.map((entry) => entry.type)).toEqual([
        AccountEntryType.CHARGE,
        AccountEntryType.PAYMENT,
        AccountEntryType.CHARGE_REVERSAL,
      ]);
      expect(account.summary.balance).toBe(-3000);
    });

    it('un consumo que ya estaba cancelado no entra, aunque esté pagado', () => {
      expect(
        planConsumptionEntries(
          buildAccount(),
          buildConsumption({ active: false, payment: { reference: 'mp-1' } }),
          NOW,
        ),
      ).toEqual([]);
    });

    it('una cuenta cerrada no recibe cargos ni pagos', () => {
      expect(
        planConsumptionEntries(
          buildAccount({ status: AccountStatus.CLOSED }),
          buildConsumption({ payment: { reference: 'mp-1' } }),
          NOW,
        ),
      ).toEqual([]);
    });

    it('un consumo de $0 no genera movimientos', () => {
      expect(
        planConsumptionEntries(
          buildAccount(),
          buildConsumption({ amount: 0 }),
          NOW,
        ),
      ).toEqual([]);
    });
  });

  describe('planConsumptionsEntries (al abrir la cuenta)', () => {
    it('trae pendientes como cargo y pagados como cargo más pago; el saldo es lo que se debe', () => {
      const orders = [
        buildOrder({ id: 'pendiente', total: 5000 }),
        buildOrder({
          id: 'pagado',
          total: 2000,
          paymentStatus: RoomServicePaymentStatus.PAID,
          mpPaymentId: 'mp-9',
        }),
        buildOrder({
          id: 'cancelado',
          total: 9000,
          status: RoomServiceOrderStatus.CANCELLED,
        }),
        buildOrder({
          id: 'borrador',
          status: RoomServiceOrderStatus.PENDING_CONFIRMATION,
        }),
      ];
      const consumptions = orders
        .map(roomServiceConsumption)
        .filter((consumption): consumption is Consumption => !!consumption);
      const account = buildAccount();

      const entries = planConsumptionsEntries(account, consumptions, NOW);
      const opened = apply(account, entries);

      expect(
        entries.map((entry) => [entry.sourceId, entry.type, entry.amount]),
      ).toEqual([
        ['pendiente', AccountEntryType.CHARGE, 5000],
        ['pagado', AccountEntryType.CHARGE, 2000],
        ['pagado', AccountEntryType.PAYMENT, 2000],
      ]);
      // lo que debe hoy según paymentStatus: solo el pedido pendiente
      const owed = orders
        .filter(
          (order) =>
            order.status !== RoomServiceOrderStatus.CANCELLED &&
            order.status !== RoomServiceOrderStatus.PENDING_CONFIRMATION &&
            order.paymentStatus === RoomServicePaymentStatus.PENDING,
        )
        .reduce((total, order) => total + order.total, 0);
      expect(opened.summary.balance).toBe(owed);
    });

    it('dos fotos del mismo pedido no se duplican', () => {
      const consumption = buildConsumption();

      expect(
        planConsumptionsEntries(
          buildAccount(),
          [consumption, consumption],
          NOW,
        ),
      ).toHaveLength(1);
    });
  });
});
