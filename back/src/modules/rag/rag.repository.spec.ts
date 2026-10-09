import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/postgresql';
import { RagRepository } from './rag.repository';
import { Document } from '../../infrastructure/database/entities/Document.entity';
import { KnowledgeDocument } from '../../infrastructure/database/entities/KnowledgeDocument.entity';

describe('RagRepository', () => {
  let repository: RagRepository;
  let em: {
    create: jest.Mock;
    persist: jest.Mock;
    flush: jest.Mock;
    getReference: jest.Mock;
    nativeDelete: jest.Mock;
    findOne: jest.Mock;
    count: jest.Mock;
    map: jest.Mock;
    getConnection: jest.Mock;
  };
  let execute: jest.Mock;

  beforeEach(async () => {
    execute = jest.fn();
    em = {
      create: jest
        .fn()
        .mockImplementation((_entity, data: Record<string, unknown>) => ({
          ...data,
        })),
      persist: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
      getReference: jest.fn().mockReturnValue({ id: 'doc-1' }),
      nativeDelete: jest.fn().mockResolvedValue(1),
      findOne: jest.fn(),
      count: jest.fn(),
      map: jest.fn().mockImplementation((_entity, row) => row),
      getConnection: jest.fn().mockReturnValue({ execute }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [RagRepository, { provide: EntityManager, useValue: em }],
    }).compile();

    repository = module.get(RagRepository);
  });

  describe('saveDocumentChunk', () => {
    it('guarda el chunk sin origen cuando viene de la carga inicial (seeder / ingest manual)', async () => {
      const saved = await repository.saveDocumentChunk('Texto', [0.1, 0.2]);

      expect(em.getReference).not.toHaveBeenCalled();
      expect(em.create).toHaveBeenCalledWith(
        Document,
        expect.objectContaining({ content: 'Texto', embedding: '[0.1,0.2]' }),
      );
      expect(saved).toMatchObject({
        sourceDocument: undefined,
        filename: undefined,
        mimeType: undefined,
      });
      expect(em.persist).toHaveBeenCalled();
      expect(em.flush).toHaveBeenCalled();
    });

    it('vincula el chunk con su documento de origen para poder borrarlo en cascada (CA4)', async () => {
      const ref = { id: 'doc-1' };
      em.getReference.mockReturnValue(ref);

      await repository.saveDocumentChunk('Texto', [0.1, 0.2], {
        id: 'doc-1',
        filename: 'reglas.pdf',
        mimeType: 'application/pdf',
      });

      expect(em.getReference).toHaveBeenCalledWith(KnowledgeDocument, 'doc-1');
      expect(em.create).toHaveBeenCalledWith(
        Document,
        expect.objectContaining({
          sourceDocument: ref,
          filename: 'reglas.pdf',
          mimeType: 'application/pdf',
        }),
      );
    });

    it('serializa el embedding con el formato que espera pgvector', async () => {
      await repository.saveDocumentChunk('Texto', [1, -0.5, 0]);

      expect(em.create).toHaveBeenCalledWith(
        Document,
        expect.objectContaining({ embedding: '[1,-0.5,0]' }),
      );
    });
  });

  describe('deleteChunksBySourceDocument', () => {
    it('borra todos los chunks del documento de origen', async () => {
      await repository.deleteChunksBySourceDocument('doc-1');

      expect(em.nativeDelete).toHaveBeenCalledWith(Document, {
        sourceDocument: { id: 'doc-1' },
      });
    });
  });

  describe('findSourceDocument', () => {
    it('busca el documento de origen por id', async () => {
      const doc = new KnowledgeDocument();
      em.findOne.mockResolvedValue(doc);

      await expect(repository.findSourceDocument('doc-1')).resolves.toBe(doc);
      expect(em.findOne).toHaveBeenCalledWith(KnowledgeDocument, {
        id: 'doc-1',
      });
    });

    it('devuelve null si el documento ya no existe', async () => {
      em.findOne.mockResolvedValue(null);

      await expect(repository.findSourceDocument('doc-1')).resolves.toBeNull();
    });
  });

  describe('findSimilar', () => {
    it('ordena por distancia al embedding de la pregunta y respeta el límite', async () => {
      const rows = [{ id: 1, content: 'Check-in 14 hs' }];
      execute.mockResolvedValue(rows);

      const result = await repository.findSimilar([0.1, 0.2], 3);

      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY embedding <-> ?::vector'),
        ['[0.1,0.2]', 3],
      );
      expect(em.map).toHaveBeenCalledWith(Document, rows[0]);
      expect(result).toEqual(rows);
    });

    it('usa 5 resultados por defecto', async () => {
      execute.mockResolvedValue([]);

      await repository.findSimilar([0.1]);

      expect(execute).toHaveBeenCalledWith(expect.any(String), ['[0.1]', 5]);
    });
  });

  describe('countDocuments', () => {
    it('cuenta los chunks indexados', async () => {
      em.count.mockResolvedValue(12);

      await expect(repository.countDocuments()).resolves.toBe(12);
      expect(em.count).toHaveBeenCalledWith(Document);
    });
  });
});
