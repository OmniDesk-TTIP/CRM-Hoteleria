import * as fs from 'fs';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/postgresql';
import { RagSeederService } from './rag.seeder.service';
import { RagService } from './rag.service';
import { RagRepository } from './rag.repository';
import {
  KnowledgeDocument,
  KnowledgeDocumentStatus,
  KnowledgeDocumentType,
} from '../../infrastructure/database/entities/KnowledgeDocument.entity';

jest.mock('fs');

describe('RagSeederService', () => {
  let service: RagSeederService;
  let ragService: RagService;
  let ragRepository: RagRepository;
  let em: {
    findOne: jest.Mock;
    create: jest.Mock;
    persist: jest.Mock;
    flush: jest.Mock;
  };
  let baseDoc: { id: string; chunksCount: number };

  beforeEach(async () => {
    baseDoc = { id: 'base-doc-id', chunksCount: 0 };
    em = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockReturnValue(baseDoc),
      persist: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RagSeederService,
        {
          provide: RagService,
          // ingestDocument devuelve la cantidad de chunks que guardó
          useValue: { ingestDocument: jest.fn().mockResolvedValue(3) },
        },
        { provide: RagRepository, useValue: { countDocuments: jest.fn() } },
        { provide: EntityManager, useValue: em },
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
    expect(em.create).not.toHaveBeenCalled();
  });

  it('ingiere cada fragmento de knowledge.json vinculado al documento base cuando la base está vacía', async () => {
    jest.spyOn(ragRepository, 'countDocuments').mockResolvedValue(0);
    jest
      .spyOn(fs, 'readFileSync')
      .mockReturnValue(JSON.stringify(['Fragmento 1', 'Fragmento 2']));

    await service.onModuleInit();

    expect(ragService.ingestDocument).toHaveBeenCalledTimes(2);
    expect(ragService.ingestDocument).toHaveBeenNthCalledWith(
      1,
      'Fragmento 1',
      'base-doc-id',
    );
    expect(ragService.ingestDocument).toHaveBeenNthCalledWith(
      2,
      'Fragmento 2',
      'base-doc-id',
    );
  });

  it('crea el documento base como READY para que el panel lo liste y se pueda eliminar', async () => {
    jest.spyOn(ragRepository, 'countDocuments').mockResolvedValue(0);
    jest
      .spyOn(fs, 'readFileSync')
      .mockReturnValue(JSON.stringify(['Fragmento 1', 'Fragmento 2']));

    await service.onModuleInit();

    expect(em.create).toHaveBeenCalledWith(
      KnowledgeDocument,
      expect.objectContaining({
        filename: 'Conocimiento Base',
        status: KnowledgeDocumentStatus.READY,
        type: KnowledgeDocumentType.TXT,
      }),
    );
    expect(em.persist).toHaveBeenCalledWith(baseDoc);
    expect(baseDoc.chunksCount).toBe(6);
  });

  it('reutiliza el documento base si ya existe', async () => {
    jest.spyOn(ragRepository, 'countDocuments').mockResolvedValue(0);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(['Uno']));
    em.findOne.mockResolvedValue(baseDoc);

    await service.onModuleInit();

    expect(em.create).not.toHaveBeenCalled();
    expect(ragService.ingestDocument).toHaveBeenCalledWith(
      'Uno',
      'base-doc-id',
    );
  });

  it('no propaga el error si knowledge.json no se puede leer', async () => {
    jest.spyOn(ragRepository, 'countDocuments').mockResolvedValue(0);
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('archivo no encontrado');
    });

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(ragService.ingestDocument).not.toHaveBeenCalled();
    expect(em.create).not.toHaveBeenCalled();
  });
});
