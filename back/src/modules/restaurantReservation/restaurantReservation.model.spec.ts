import { RestaurantReservationStatus } from '../../infrastructure/database/entities/RestaurantReservation.entity';
import { MAX_ENTRY_DESCRIPTION_LENGTH } from '../account/account.model';
import {
  MAX_TICKET_DETAIL_LENGTH,
  MAX_TICKET_NUMBER_LENGTH,
  RestaurantReservationModel,
  ticketDescription,
} from './restaurantReservation.model';

const newRequest = () =>
  RestaurantReservationModel.create({
    telegramUserId: 'tg-1',
    roomReservationId: 'res-1',
    guestFullName: 'Ana Huésped',
    requestedDate: '2099-03-16',
    requestedTime: '21:00',
    partySize: 2,
    notes: null,
  });

describe('RestaurantReservationModel', () => {
  it('todo pedido arranca pendiente de recepción', () => {
    expect(newRequest().status).toBe(RestaurantReservationStatus.PENDING);
  });

  describe('getDateError', () => {
    const base = {
      today: '2099-03-15',
      nowMinutes: 20 * 60,
      stay: { checkIn: '2099-03-14', checkOut: '2099-03-18' },
    };

    it('acepta un horario dentro de la estadía', () => {
      expect(
        RestaurantReservationModel.getDateError({
          ...base,
          requestedDate: '2099-03-18',
          requestedTime: '13:00',
        }),
      ).toBeNull();
    });

    it.each([
      ['2099-03-14', '21:00', 'ya pasó'],
      ['2099-03-15', '19:30', 'Ese horario ya pasó'],
      ['2099-03-19', '21:00', 'estadía'],
    ])('rechaza %s %s', (requestedDate, requestedTime, message) => {
      expect(
        RestaurantReservationModel.getDateError({
          ...base,
          requestedDate,
          requestedTime,
        }),
      ).toContain(message);
    });
  });

  describe('changeStatus', () => {
    it('recepción confirma o rechaza un pedido pendiente', () => {
      const request = newRequest();
      expect(
        request.changeStatus(RestaurantReservationStatus.CONFIRMED),
      ).toBeNull();
      expect(request.status).toBe(RestaurantReservationStatus.CONFIRMED);
    });

    it('un pedido resuelto no cambia más', () => {
      const request = newRequest();
      request.changeStatus(RestaurantReservationStatus.REJECTED);
      expect(
        request.changeStatus(RestaurantReservationStatus.CONFIRMED),
      ).not.toBeNull();
      expect(request.status).toBe(RestaurantReservationStatus.REJECTED);
    });
  });

  it('arma el aviso al huésped solo cuando el pedido se resuelve', () => {
    const request = newRequest();
    expect(request.getStatusNotice()).toBeNull();

    request.changeStatus(RestaurantReservationStatus.CONFIRMED);
    expect(request.getStatusNotice()).toBe(
      '✅ Tu mesa en el restaurante del 16/03/2099 a las 21:00 para 2 personas quedó confirmada. ¡Te esperamos!',
    );
  });

  describe('ticket del restó (US-27)', () => {
    it('solo se carga sobre una mesa confirmada', () => {
      const request = newRequest();
      expect(request.getTicketError()).toMatch(/confirmada/);

      request.changeStatus(RestaurantReservationStatus.CONFIRMED);
      expect(request.getTicketError()).toBeNull();
    });

    it('una mesa rechazada no admite ticket', () => {
      const request = newRequest();
      request.changeStatus(RestaurantReservationStatus.REJECTED);

      expect(request.getTicketError()).toMatch(/confirmada/);
    });

    it.each([
      ['1234', 'Cena para 2', 'Restó: ticket N° 1234 · Cena para 2'],
      ['1234', null, 'Restó: ticket N° 1234'],
      [null, 'Cena para 2', 'Restó: Cena para 2'],
      [null, null, 'Restó: consumo'],
      ['   ', '  ', 'Restó: consumo'],
    ])(
      'con ticket %s y detalle %s la descripción es "%s"',
      (ticketNumber, detail, expected) => {
        expect(ticketDescription(ticketNumber, detail)).toBe(expected);
      },
    );

    it('con los topes de largo entra en la descripción de un movimiento', () => {
      const description = ticketDescription(
        'x'.repeat(MAX_TICKET_NUMBER_LENGTH),
        'y'.repeat(MAX_TICKET_DETAIL_LENGTH),
      );

      expect(description.length).toBeLessThanOrEqual(
        MAX_ENTRY_DESCRIPTION_LENGTH,
      );
    });
  });
});
