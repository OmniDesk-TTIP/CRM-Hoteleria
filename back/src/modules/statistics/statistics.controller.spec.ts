import 'reflect-metadata';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';
import { RolesGuard } from '../auth/auth.guard';
import { ROLES_KEY } from '../auth/auth.decorators';
import { UserRole } from '../../infrastructure/database/entities/User.entity';

describe('StatisticsController', () => {
  let service: jest.Mocked<Pick<StatisticsService, 'getStatistics'>>;
  let controller: StatisticsController;

  beforeEach(() => {
    service = { getStatistics: jest.fn() };
    controller = new StatisticsController(
      service as unknown as StatisticsService,
    );
  });

  it('GET / delega en statisticsService.getStatistics con el range de la query', () => {
    controller.get({ range: '7d' });

    expect(service.getStatistics).toHaveBeenCalledWith('7d');
  });

  it('solo lo puede ver un Administrador (CA5)', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, StatisticsController) as
      | UserRole[]
      | undefined;
    const guards = Reflect.getMetadata('__guards__', StatisticsController) as
      | unknown[]
      | undefined;

    expect(roles).toEqual([UserRole.ADMIN]);
    expect(guards).toContain(RolesGuard);
  });
});
