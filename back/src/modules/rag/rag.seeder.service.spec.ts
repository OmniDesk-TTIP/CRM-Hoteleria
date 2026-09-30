import * as fs from 'fs';
import { Test, TestingModule } from '@nestjs/testing';
import { RagSeederService } from './rag.seeder.service';
import { RagService } from './rag.service';
import { RagRepository } from './rag.repository';

jest.mock('fs');

describe('RagSeederService', () => {
  let service: RagSeederService;
  let ragService: RagService;
  let ragRepository: RagRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RagSeederService,
        { provide: RagService, useValue: { ingestDocument: jest.fn().mockResolvedValue(undefined) } },
        { provide: RagRepository, useValue: { countDocuments: jest.fn() } },
      ],
    }).compile();

    service = module.get<RagSeederService>(RagSeederService);
    ragService = module.get<RagService>(RagService);
    ragRepository = module.get<RagRepository>(RagRepository);

    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('no siembra nada si ya hay documentos cargados', async () => {
    jest.spyOn(ragRepository, 'countDocuments').mockResolvedValue(3);

    await service.onModuleInit();

    expect(ragService.ingestDocument).not.toHaveBeenCalled();
  });

  it('ingiere cada fragmento de knowledge.json cuando la base está vacía', async () => {
    jest.spyOn(ragRepository, 'countDocuments').mockResolvedValue(0);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(['Fragmento 1', 'Fragmento 2']));

    await service.onModuleInit();

    expect(ragService.ingestDocument).toHaveBeenCalledTimes(2);
    expect(ragService.ingestDocument).toHaveBeenNthCalledWith(1, 'Fragmento 1');
    expect(ragService.ingestDocument).toHaveBeenNthCalledWith(2, 'Fragmento 2');
  });

  it('no propaga el error si knowledge.json no se puede leer', async () => {
    jest.spyOn(ragRepository, 'countDocuments').mockResolvedValue(0);
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('archivo no encontrado');
    });

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(ragService.ingestDocument).not.toHaveBeenCalled();
  });
});
