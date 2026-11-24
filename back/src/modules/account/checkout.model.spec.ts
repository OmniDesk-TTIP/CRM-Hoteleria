import {
  AccountStatus,
  PaymentMethod,
} from '../../infrastructure/database/entities/Account.entity';
import {
  AccountEntryOrigin,
  AccountEntryType,
} from '../../infrastructure/database/entities/AccountEntry.entity';
import { ReservationStatus } from '../../infrastructure/database/entities/Reservation.entity';
import { AccountEntryModel, AccountModel, AccountProps } from './account.model';
import {
  ActiveService,
  CheckoutBlockCode,
  CheckoutState,
  getCheckoutBlock,
} from './checkout.model';

const NOW = new Date(Date.UTC(2099, 2, 20, 13, 0));

const entry = (type: AccountEntryType, amount: number) =>
  AccountEntryModel.create(
    'account-1',
    {
      type: type as AccountEntryType.CHARGE,
      amount,
      description: 'Movimiento',
      origin: AccountEntryOrigin.RECEPTION,
      paymentMethod:
        type === AccountEntryType.CHARGE ? null : PaymentMethod.CARD,
    },
    { userId: 'user-1' },
    NOW,
  );

const buildAccount = (overrides: Partial<AccountProps> = {}) =>
  new AccountModel({
    id: 'account-1',
    reservationId: 'reservation-1',
    status: AccountStatus.OPEN,
    stayBalanceAmount: 70000,
    stayBalancePaymentMethod: PaymentMethod.CASH,
    openedById: 'user-1',
    openedByName: 'Recepción',
    openedAt: NOW,
    closedAt: null,
    entries: [],
    ...overrides,
  });

const ROOM_SERVICE: ActiveService = {
  kind: 'ROOM_SERVICE',
  id: 'order-1',
  description: 'Room service: 2 x Café (en preparación)',
};

const buildState = (overrides: Partial<CheckoutState> = {}): CheckoutState => ({
  reservationStatus: ReservationStatus.CONFIRMED,
  checkedOutAt: null,
  account: buildAccount(),
  activeServices: [],
  ...overrides,
});

describe('getCheckoutBlock (US-30)', () => {
  it('con la cuenta en $0 y sin consumos en curso se puede hacer', () => {
    expect(getCheckoutBlock(buildState(), false)).toBeNull();
  });

  it('con cargos pagados del todo también', () => {
    const account = buildAccount({
      entries: [
        entry(AccountEntryType.CHARGE, 5000),
        entry(AccountEntryType.PAYMENT, 5000),
      ],
    });

    expect(getCheckoutBlock(buildState({ account }), false)).toBeNull();
  });

  it('con saldo pendiente lo rechaza y devuelve cuánto debe', () => {
    const account = buildAccount({
      entries: [
        entry(AccountEntryType.CHARGE, 5000),
        entry(AccountEntryType.PAYMENT, 1500.5),
      ],
    });

    expect(getCheckoutBlock(buildState({ account }), true)).toEqual({
      code: CheckoutBlockCode.PENDING_BALANCE,
      message: expect.stringMatching(/saldo pendiente de \$3\.499,50/),
      balance: 3499.5,
    });
  });

  it('con saldo a favor pide hacer el reintegro antes', () => {
    const account = buildAccount({
      entries: [
        entry(AccountEntryType.CHARGE, 1000),
        entry(AccountEntryType.PAYMENT, 1500),
      ],
    });

    expect(getCheckoutBlock(buildState({ account }), false)).toMatchObject({
      code: CheckoutBlockCode.PENDING_BALANCE,
      message: expect.stringMatching(/reintegro/),
      balance: -500,
    });
  });

  it('avisa los consumos en curso y se puede seguir con force', () => {
    const state = buildState({ activeServices: [ROOM_SERVICE] });

    expect(getCheckoutBlock(state, false)).toEqual({
      code: CheckoutBlockCode.ACTIVE_SERVICES,
      message: expect.stringMatching(/consumos en curso/),
      activeServices: [ROOM_SERVICE],
    });
    expect(getCheckoutBlock(state, true)).toBeNull();
  });

  it('el saldo se chequea antes que los consumos en curso', () => {
    const account = buildAccount({
      entries: [entry(AccountEntryType.CHARGE, 1000)],
    });

    expect(
      getCheckoutBlock(
        buildState({ account, activeServices: [ROOM_SERVICE] }),
        false,
      )?.code,
    ).toBe(CheckoutBlockCode.PENDING_BALANCE);
  });

  it('sin cuenta abierta pide registrar el pago del resto de la estadía', () => {
    expect(
      getCheckoutBlock(buildState({ account: null }), false),
    ).toMatchObject({
      code: CheckoutBlockCode.NO_ACCOUNT,
      message: expect.stringMatching(/resto de la estadía/),
    });
  });

  it.each([
    ['con checkout hecho', buildState({ checkedOutAt: NOW })],
    [
      'con la cuenta cerrada',
      buildState({ account: buildAccount({ status: AccountStatus.CLOSED }) }),
    ],
  ])('no repite el checkout %s', (_case, state) => {
    expect(getCheckoutBlock(state, true)?.code).toBe(
      CheckoutBlockCode.ALREADY_CHECKED_OUT,
    );
  });

  it.each([
    [ReservationStatus.PENDING_PAYMENT],
    [ReservationStatus.CANCELLED],
    [ReservationStatus.EXPIRED],
  ])('no hace el checkout de una reserva %s', (reservationStatus) => {
    expect(
      getCheckoutBlock(buildState({ reservationStatus }), true)?.code,
    ).toBe(CheckoutBlockCode.NOT_CONFIRMED);
  });
});
