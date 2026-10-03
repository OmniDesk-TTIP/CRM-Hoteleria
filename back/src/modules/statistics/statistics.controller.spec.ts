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
    void controller.get({ range: '7d' });

    expect(service.getStatistics).toHaveBeenCalledWith('7d');
  });

  it('solo lo puede ver un Administrador (CA5)', () => {
    const target = StatisticsController;
    const roles: unknown = Reflect.getMetadata(ROLES_KEY, target);
    const guards: unknown = Reflect.getMetadata('__guards__', target);

    expect(roles).toEqual([UserRole.ADMIN]);
    expect(guards).toContain(RolesGuard);
  });
});
