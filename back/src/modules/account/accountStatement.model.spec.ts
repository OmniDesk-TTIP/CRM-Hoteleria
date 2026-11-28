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
  AccountModel,
  AccountReservationInfo,
} from './account.model';
import {
  buildAccountStatement,
  STATEMENT_LEGAL_NOTE,
} from './accountStatement.model';
import { renderAccountStatement } from './accountStatement.renderer';

const TIME_ZONE = 'America/Argentina/Buenos_Aires';
// 15/03/2099 a las HH:00 en UTC; en Buenos Aires son 3 horas menos
const at = (hour: number) => new Date(Date.UTC(2099, 2, 15, hour, 0));

const entry = (
  type: AccountEntryType,
  amount: number,
  description: string,
  origin: AccountEntryOrigin,
  hour: number,
) =>
  AccountEntryModel.create(
    'account-1',
    {
      type: type as AccountEntryType.CHARGE,
      amount,
      description,
      origin,
      paymentMethod:
        type === AccountEntryType.CHARGE ? null : PaymentMethod.CARD,
    },
    { userId: 'user-1' },
    at(hour),
  );

const RESERVATION: AccountReservationInfo = {
  id: 'reservation-1',
  status: ReservationStatus.CONFIRMED,
  totalAmount: 100000,
  depositAmount: 30000,
  guestFullName: 'Ana Pérez',
  guestDni: '30111222',
  roomNumber: '101',
  categoryName: 'Suite Deluxe',
  checkIn: '2099-03-10',
  checkOut: '2099-03-20',
  checkedOutAt: null,
  checkedOutByName: null,
};

const accountWith = (entries: AccountEntryModel[]) =>
  new AccountModel({
    id: 'account-1',
    reservationId: 'reservation-1',
    status: AccountStatus.OPEN,
    stayBalanceAmount: 70000,
    stayBalancePaymentMethod: PaymentMethod.CASH,
    openedById: 'user-1',
    openedByName: 'Recepción',
    openedAt: at(10),
    closedAt: null,
    entries,
  });

const build = (
  entries: AccountEntryModel[],
  reservation: Partial<AccountReservationInfo> = {},
) =>
  buildAccountStatement(
    { ...RESERVATION, ...reservation },
    accountWith(entries),
    'Alma Hotel',
    at(25),
    TIME_ZONE,
  );

// los montos llevan espacio duro después del $ (así los formatea Intl en es-AR)
describe('Estado de cuenta (US-28)', () => {
  const roomService = entry(
    AccountEntryType.CHARGE,
    7500,
    'Room service: 2 x Café',
    AccountEntryOrigin.ROOM_SERVICE,
    13,
  );
  const bar = entry(
    AccountEntryType.CHARGE,
    4200,
    'Bar: ticket N° 88',
    AccountEntryOrigin.BAR,
    22,
  );
  const barReversal = AccountEntryModel.reversalOf(
    bar,
    'Se cargó a la habitación equivocada',
    { userId: 'user-1' },
    at(23),
  );
  const restaurant = entry(
    AccountEntryType.CHARGE,
    18500.5,
    'Restó: ticket N° 1234',
    AccountEntryOrigin.RESTAURANT,
    23,
  );
  const payment = entry(
    AccountEntryType.PAYMENT,
    20000,
    'Pago en tarjeta',
    AccountEntryOrigin.RECEPTION,
    24,
  );

  it('dice que es un comprobante interno, no válido como factura', () => {
    expect(build([]).legalNote).toBe(STATEMENT_LEGAL_NOTE);
    expect(STATEMENT_LEGAL_NOTE).toMatch(/no válido como factura/);
  });

  it('muestra los datos del huésped y de la reserva', () => {
    expect(build([]).details).toEqual([
      { label: 'Huésped', value: 'Ana Pérez' },
      { label: 'DNI', value: '30111222' },
      { label: 'Habitación', value: '101 · Suite Deluxe' },
      { label: 'Estadía', value: '10/03/2099 al 20/03/2099' },
      { label: 'Checkout', value: 'Pendiente' },
    ]);
  });

  it('con checkout hecho muestra cuándo, en la hora del hotel', () => {
    const { details } = build([], { checkedOutAt: at(14) });

    expect(details.at(-1)).toEqual({
      label: 'Checkout',
      value: '15/03/2099, 11:00',
    });
  });

  it('ordena por fecha y deja cada anulación debajo del movimiento anulado', () => {
    const { rows } = build([
      payment,
      barReversal,
      restaurant,
      roomService,
      bar,
    ]);

    expect(
      rows.map(({ detail, reversed, isReversal }) => [
        detail,
        reversed,
        isReversal,
      ]),
    ).toEqual([
      ['Room service: 2 x Café', false, false],
      ['Bar: ticket N° 88', true, false],
      ['Anulación: Se cargó a la habitación equivocada', false, true],
      ['Restó: ticket N° 1234', false, false],
      ['Pago en tarjeta', false, false],
    ]);
  });

  it('cada fila tiene fecha, origen y monto con el signo según cómo mueve el saldo', () => {
    const { rows } = build([roomService, bar, barReversal, payment]);

    expect(
      rows.map(({ date, origin, amount }) => [date, origin, amount]),
    ).toEqual([
      ['15/03/2099, 10:00', 'Room service', '+ $ 7.500,00'],
      ['15/03/2099, 19:00', 'Bar', '+ $ 4.200,00'],
      ['15/03/2099, 20:00', 'Bar', '- $ 4.200,00'],
      ['15/03/2099, 21:00', 'Recepción', '- $ 20.000,00'],
    ]);
  });

  it('termina con el total de cargos, el de pagos y el saldo', () => {
    const { totals } = build([
      roomService,
      bar,
      barReversal,
      restaurant,
      payment,
    ]);

    expect(totals).toEqual([
      { label: 'Total de cargos', value: '$ 26.000,50' },
      { label: 'Total de pagos', value: '$ 20.000,00' },
      {
        label: 'Saldo (debe el huésped)',
        value: '$ 6.000,50',
        highlight: true,
      },
    ]);
  });

  it.each([
    [[] as AccountEntryModel[], 'Saldo'],
    [
      [
        entry(AccountEntryType.CHARGE, 100, 'Café', AccountEntryOrigin.BAR, 13),
        entry(
          AccountEntryType.PAYMENT,
          150,
          'Pago',
          AccountEntryOrigin.RECEPTION,
          14,
        ),
      ],
      'Saldo (a favor del huésped)',
    ],
  ])('el saldo dice de qué lado está', (entries, label) => {
    expect(build(entries).totals.at(-1)?.label).toBe(label);
  });

  it('el archivo se llama por habitación y fecha de entrada', () => {
    expect(build([], { roomNumber: 'Suite 2' }).filename).toBe(
      'estado-de-cuenta-hab-suite-2-2099-03-10.pdf',
    );
  });

  it('se dibuja como PDF, también sin movimientos y con muchos', async () => {
    const many = Array.from({ length: 80 }, (_, index) =>
      entry(
        AccountEntryType.CHARGE,
        100 + index,
        `Consumo ${index} con un detalle bastante largo para que ocupe más de una línea en la tabla`,
        AccountEntryOrigin.RECEPTION,
        12,
      ),
    );

    for (const statement of [build([]), build(many)]) {
      const pdf = await renderAccountStatement(statement);
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    }
  });
});
