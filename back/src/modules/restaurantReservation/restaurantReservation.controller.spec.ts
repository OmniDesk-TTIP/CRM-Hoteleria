import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '../../infrastructure/database/entities/User.entity';
import { ROLES_KEY } from '../auth/auth.decorators';
import { RolesGuard } from '../auth/auth.guard';
import { RestaurantReservationController } from './restaurantReservation.controller';

const rolesOf = (handler: keyof RestaurantReservationController) => ({
  roles: Reflect.getMetadata(
    ROLES_KEY,
    RestaurantReservationController.prototype[handler],
  ) as UserRole[] | undefined,
  guards: Reflect.getMetadata(
    GUARDS_METADATA,
    RestaurantReservationController.prototype[handler],
  ) as unknown[] | undefined,
});

/** US-27: cualquier usuario del panel carga el ticket; solo un administrador lo anula. */
describe('RestaurantReservationController (roles)', () => {
  it('reverseTicket es solo para administradores', () => {
    expect(rolesOf('reverseTicket')).toEqual({
      roles: [UserRole.ADMIN],
      guards: [RolesGuard],
    });
  });

  it.each(['list', 'changeStatus', 'chargeTicket'] as const)(
    '%s lo puede usar cualquier usuario del panel',
    (handler) => {
      expect(rolesOf(handler)).toEqual({ roles: undefined, guards: undefined });
    },
  );
});
