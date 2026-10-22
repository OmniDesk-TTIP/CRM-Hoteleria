import { RestaurantReservationStatus } from '../../infrastructure/database/entities/RestaurantReservation.entity';
import { RestaurantReservationModel } from './restaurantReservation.model';

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
});
