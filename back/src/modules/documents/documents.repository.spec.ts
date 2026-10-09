import { Test, TestingModule } from '@nestjs/testing';
import { RequestContext } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { DocumentsRepository } from './documents.repository';
import {
  KnowledgeDocument,
  KnowledgeDocumentStatus,
  KnowledgeDocumentType,
} from '../../infrastructure/database/entities/KnowledgeDocument.entity';

describe('DocumentsRepository', () => {
  let repository: DocumentsRepository;
  let em: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    persist: jest.Mock;
    flush: jest.Mock;
    nativeUpdate: jest.Mock;
    nativeDelete: jest.Mock;
  };

  beforeEach(async () => {
    em = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      persist: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
      nativeUpdate: jest.fn().mockResolvedValue(1),
      nativeDelete: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsRepository,
        { provide: EntityManager, useValue: em },
      ],
    }).compile();

    repository = module.get(DocumentsRepository);
  });

  it('findAll ordena del más reciente al más viejo (CA3)', async () => {
    em.find.mockResolvedValue([]);

    await repository.findAll();

    expect(em.find).toHaveBeenCalledWith(
      KnowledgeDocument,
      {},
      { orderBy: { createdAt: 'desc' } },
    );
  });

  it('findById busca por id', async () => {
    em.findOne.mockResolvedValue(null);

    await expect(repository.findById('doc-1')).resolves.toBeNull();
    expect(em.findOne).toHaveBeenCalledWith(KnowledgeDocument, { id: 'doc-1' });
  });

  it('findInProgress busca los documentos PENDING y PROCESSING', async () => {
    em.find.mockResolvedValue([]);

    await repository.findInProgress();

    expect(em.find).toHaveBeenCalledWith(KnowledgeDocument, {
      status: {
        $in: [
          KnowledgeDocumentStatus.PENDING,
          KnowledgeDocumentStatus.PROCESSING,
        ],
      },
    });
  });

  it('runInContext ejecuta el trabajo dentro de un RequestContext propio', async () => {
    const createSpy = jest
      .spyOn(RequestContext, 'create')
      .mockImplementation((_em: unknown, work: () => unknown) => work());
    const work = jest.fn().mockResolvedValue('listo');

    await expect(repository.runInContext(work)).resolves.toBe('listo');

    expect(createSpy).toHaveBeenCalledWith(em, work);
    createSpy.mockRestore();
  });

  it('create arma el documento siempre en PENDING y con 0 chunks', () => {
    const data = {
      filename: 'reglas.txt',
      mimeType: 'text/plain',
      type: KnowledgeDocumentType.TXT,
      sizeBytes: 10,
      storagePath: '',
      uploadedById: 'admin-1',
    };

    repository.create(data);

    expect(em.create).toHaveBeenCalledWith(KnowledgeDocument, {
      ...data,
      status: KnowledgeDocumentStatus.PENDING,
      chunksCount: 0,
    });
  });

  it('saveNew persiste y hace flush', async () => {
    const doc = new KnowledgeDocument();

    await repository.saveNew(doc);

    expect(em.persist).toHaveBeenCalledWith(doc);
    expect(em.flush).toHaveBeenCalledTimes(1);
  });

  it('markProcessing pasa a PROCESSING y limpia un error anterior', async () => {
    await repository.markProcessing('doc-1');

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      KnowledgeDocument,
      { id: 'doc-1' },
      { status: KnowledgeDocumentStatus.PROCESSING, errorMessage: null },
    );
  });

  it('markReady pasa a READY con la cantidad de chunks y sin error', async () => {
    await repository.markReady('doc-1', 5);

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      KnowledgeDocument,
      { id: 'doc-1' },
      {
        status: KnowledgeDocumentStatus.READY,
        chunksCount: 5,
        errorMessage: null,
      },
    );
  });

  it('markError pasa a ERROR y guarda el mensaje', async () => {
    await repository.markError('doc-1', 'Falló');

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      KnowledgeDocument,
      { id: 'doc-1' },
      { status: KnowledgeDocumentStatus.ERROR, errorMessage: 'Falló' },
    );
  });

  it('markError recorta el mensaje a 500 caracteres', async () => {
    await repository.markError('doc-1', 'x'.repeat(900));

    const [, , changes] = em.nativeUpdate.mock.calls[0] as [
      unknown,
      unknown,
      { errorMessage: string },
    ];
    expect(changes.errorMessage).toHaveLength(500);
  });

  it('deleteById borra el documento por id (los chunks caen por la FK con cascade)', async () => {
    await repository.deleteById('doc-1');

    expect(em.nativeDelete).toHaveBeenCalledWith(KnowledgeDocument, {
      id: 'doc-1',
    });
  });
});
