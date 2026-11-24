import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '../../infrastructure/database/entities/User.entity';
import { ROLES_KEY } from '../auth/auth.decorators';
import { RolesGuard } from '../auth/auth.guard';
import { AccountController } from './account.controller';

const rolesOf = (handler: keyof AccountController) => ({
  roles: Reflect.getMetadata(
    ROLES_KEY,
    AccountController.prototype[handler],
  ) as UserRole[] | undefined,
  guards: Reflect.getMetadata(
    GUARDS_METADATA,
    AccountController.prototype[handler],
  ) as unknown[] | undefined,
});

/** US-28: quién puede hacer qué con la cuenta. ADMIN y EMPLOYEE pasan el guard global. */
describe('AccountController (roles)', () => {
  it.each(['reversePayment', 'registerRefund', 'reverseCharge'] as const)(
    '%s es solo para administradores',
    (handler) => {
      expect(rolesOf(handler)).toEqual({
        roles: [UserRole.ADMIN],
        guards: [RolesGuard],
      });
    },
  );

  it.each([
    'get',
    'open',
    'registerPayment',
    'registerCharge',
    'checkout',
    'statement',
  ] as const)('%s lo puede usar cualquier usuario del panel', (handler) => {
    expect(rolesOf(handler)).toEqual({
      roles: undefined,
      guards: undefined,
    });
  });
});
