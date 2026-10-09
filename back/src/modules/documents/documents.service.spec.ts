import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { promises as fsPromises } from 'fs';
import { join } from 'path';
import pdfParse from 'pdf-parse';
import { DocumentsService } from './documents.service';
import { DocumentsRepository } from './documents.repository';
import { RagService } from '../rag/rag.service';
import { MAX_UPLOAD_BYTES } from './documents.constants';
import {
  KnowledgeDocument,
  KnowledgeDocumentStatus,
  KnowledgeDocumentType,
} from '../../infrastructure/database/entities/KnowledgeDocument.entity';

jest.mock('pdf-parse', () => jest.fn());

const pdfParseMock = pdfParse as unknown as jest.Mock;

const UPLOAD_DIR = 'uploads/test-docs';

const flushPromises = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

const buildDoc = (
  overrides: Partial<KnowledgeDocument> = {},
): KnowledgeDocument =>
  Object.assign(new KnowledgeDocument(), {
    filename: 'reglas.txt',
    mimeType: 'text/plain',
    type: KnowledgeDocumentType.TXT,
    sizeBytes: 20,
    storagePath: 'abc.txt',
    createdAt: new Date('2026-10-01T12:00:00.000Z'),
    ...overrides,
  });

const buildFile = (
  overrides: Partial<Parameters<DocumentsService['upload']>[0]> = {},
) => {
  const buffer = Buffer.from(
    'Check-in desde las 14:00. Check-out hasta las 10:00.',
  );
  return {
    originalname: 'reglas.txt',
    mimetype: 'text/plain',
    size: buffer.length,
    buffer,
    ...overrides,
  };
};

describe('DocumentsService', () => {
  let service: DocumentsService;
  let repo: Record<string, jest.Mock>;
  let ragService: {
    ingestDocument: jest.Mock;
    removeDocumentChunks: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      findAll: jest.fn(),
      findById: jest.fn(),
      create: jest.fn().mockImplementation((data) => buildDoc(data)),
      saveNew: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue(undefined),
      markProcessing: jest.fn().mockResolvedValue(undefined),
      markReady: jest.fn().mockResolvedValue(undefined),
      markError: jest.fn().mockResolvedValue(undefined),
      deleteById: jest.fn().mockResolvedValue(undefined),
      findInProgress: jest.fn().mockResolvedValue([]),
      runInContext: jest
        .fn()
        .mockImplementation((work: () => unknown) => work()),
    };
    ragService = {
      ingestDocument: jest.fn().mockResolvedValue(3),
      removeDocumentChunks: jest.fn().mockResolvedValue(undefined),
    };
    pdfParseMock.mockReset();

    jest.spyOn(fsPromises, 'mkdir').mockResolvedValue(undefined);
    jest.spyOn(fsPromises, 'writeFile').mockResolvedValue(undefined);
    jest.spyOn(fsPromises, 'unlink').mockResolvedValue(undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: DocumentsRepository, useValue: repo },
        { provide: RagService, useValue: ragService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(UPLOAD_DIR) },
        },
      ],
    }).compile();

    service = module.get(DocumentsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('list (CA3)', () => {
    it('devuelve nombre, tipo, tamaño, estado y fecha de carga de cada documento', async () => {
      repo.findAll.mockResolvedValue([
        buildDoc({ filename: 'reglas.txt' }),
        buildDoc({
          filename: 'politicas.pdf',
          type: KnowledgeDocumentType.PDF,
          mimeType: 'application/pdf',
          status: KnowledgeDocumentStatus.READY,
          chunksCount: 4,
        }),
      ]);

      const result = await service.list();

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        filename: 'reglas.txt',
        type: 'TXT',
        status: 'PENDING',
        createdAt: '2026-10-01T12:00:00.000Z',
      });
      expect(result[1]).toMatchObject({
        filename: 'politicas.pdf',
        type: 'PDF',
        status: 'READY',
        chunksCount: 4,
      });
    });

    it('devuelve una lista vacía cuando no hay documentos', async () => {
      repo.findAll.mockResolvedValue([]);

      await expect(service.list()).resolves.toEqual([]);
    });

    it('no expone la ruta interna del archivo ni quién lo subió', async () => {
      repo.findAll.mockResolvedValue([buildDoc({ uploadedById: 'user-1' })]);

      const [dto] = await service.list();

      expect(dto).not.toHaveProperty('storagePath');
      expect(dto).not.toHaveProperty('uploadedById');
    });
  });

  describe('upload - validación (CA1)', () => {
    it('rechaza un archivo que supera el tamaño máximo sin crear nada', async () => {
      const file = buildFile({ size: MAX_UPLOAD_BYTES + 1 });

      await expect(service.upload(file, 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.upload(file, 'admin-1')).rejects.toThrow(
        /tamaño máximo/,
      );
      expect(repo.create).not.toHaveBeenCalled();
      expect(fsPromises.writeFile).not.toHaveBeenCalled();
    });

    it.each([
      ['foto.png', 'image/png'],
      [
        'reglas.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
      ['planilla.xlsx', 'application/vnd.ms-excel'],
    ])(
      'rechaza %s (%s) con un mensaje claro y sin tocar la base ni el disco',
      async (originalname, mimetype) => {
        await expect(
          service.upload(buildFile({ originalname, mimetype }), 'admin-1'),
        ).rejects.toThrow('Formato no soportado. Solo se aceptan PDF y TXT.');

        expect(repo.create).not.toHaveBeenCalled();
        expect(fsPromises.writeFile).not.toHaveBeenCalled();
      },
    );

    it('acepta un TXT cuyo mimetype viene genérico y lo normaliza a text/plain', async () => {
      await service.upload(
        buildFile({
          originalname: 'reglas.txt',
          mimetype: 'application/octet-stream',
        }),
        'admin-1',
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mimeType: 'text/plain',
          type: KnowledgeDocumentType.TXT,
        }),
      );
    });

    it('acepta la extensión en mayúsculas', async () => {
      await service.upload(
        buildFile({ originalname: 'REGLAS.PDF', mimetype: 'application/pdf' }),
        'admin-1',
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: KnowledgeDocumentType.PDF }),
      );
    });

    it.each([
      ['reglas.exe', 'text/plain'],
      ['reglas.exe', 'application/pdf'],
      ['reglas.docx', 'text/plain'],
    ])(
      'rechaza %s aunque el mimetype declarado sea %s',
      async (originalname, mimetype) => {
        await expect(
          service.upload(buildFile({ originalname, mimetype }), 'admin-1'),
        ).rejects.toThrow('Formato no soportado. Solo se aceptan PDF y TXT.');

        expect(repo.create).not.toHaveBeenCalled();
      },
    );

    it('ignora un mimetype que no es un tipo real (p. ej. "constructor") y deriva el tipo de la extensión', async () => {
      await service.upload(
        buildFile({ originalname: 'reglas.txt', mimetype: 'constructor' }),
        'admin-1',
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: KnowledgeDocumentType.TXT }),
      );
    });
  });

  describe('upload - guardado (CA2)', () => {
    it('crea el registro en PENDING con los datos del archivo y de quién lo subió', async () => {
      const file = buildFile({ originalname: 'Reglas del hotel.txt' });

      await service.upload(file, 'admin-1');

      expect(repo.create).toHaveBeenCalledWith({
        filename: 'Reglas del hotel.txt',
        mimeType: 'text/plain',
        type: KnowledgeDocumentType.TXT,
        sizeBytes: file.size,
        storagePath: '',
        uploadedById: 'admin-1',
      });
      expect(repo.saveNew).toHaveBeenCalledTimes(1);
    });

    it('guarda el archivo con la extensión del tipo detectado, no con la que mandó el cliente', async () => {
      await service.upload(
        buildFile({ originalname: 'REGLAS.TXT' }),
        'admin-1',
      );

      const created = repo.create.mock.results[0].value as KnowledgeDocument;
      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        join(UPLOAD_DIR, `${created.id}.txt`),
        expect.any(Buffer),
      );
    });

    it('normaliza el mimetype guardado al del tipo detectado', async () => {
      pdfParseMock.mockResolvedValue({
        text: 'Texto del PDF con las políticas.',
      });

      await service.upload(
        buildFile({
          originalname: 'politicas.pdf',
          mimetype: 'application/octet-stream',
        }),
        'admin-1',
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ mimeType: 'application/pdf' }),
      );
    });

    it('guarda el archivo en UPLOAD_DIR con el id del documento como nombre', async () => {
      const file = buildFile({
        originalname: 'Políticas de cancelación.pdf',
        mimetype: 'application/pdf',
      });
      pdfParseMock.mockResolvedValue({
        text: 'Texto del PDF con las políticas.',
      });

      await service.upload(file, 'admin-1');

      const created = repo.create.mock.results[0].value as KnowledgeDocument;
      expect(fsPromises.mkdir).toHaveBeenCalledWith(UPLOAD_DIR, {
        recursive: true,
      });
      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        join(UPLOAD_DIR, `${created.id}.pdf`),
        file.buffer,
      );
      expect(created.storagePath).toBe(`${created.id}.pdf`);
      expect(repo.save).toHaveBeenCalled();
    });

    it('si no se puede escribir el archivo, elimina el registro y responde 500 sin procesar nada', async () => {
      (fsPromises.writeFile as jest.Mock).mockRejectedValue(
        new Error('ENOSPC: no space left on device'),
      );

      await expect(service.upload(buildFile(), 'admin-1')).rejects.toThrow(
        InternalServerErrorException,
      );
      await flushPromises();

      const created = repo.create.mock.results[0].value as KnowledgeDocument;
      expect(repo.deleteById).toHaveBeenCalledWith(created.id);
      expect(repo.markProcessing).not.toHaveBeenCalled();
      expect(ragService.ingestDocument).not.toHaveBeenCalled();
    });

    it('si no se puede crear la carpeta de destino, también elimina el registro', async () => {
      (fsPromises.mkdir as jest.Mock).mockRejectedValue(new Error('EACCES'));

      await expect(service.upload(buildFile(), 'admin-1')).rejects.toThrow(
        InternalServerErrorException,
      );

      expect(repo.deleteById).toHaveBeenCalled();
    });

    it('responde enseguida con el documento en PENDING, sin esperar la vectorización', async () => {
      let release!: (n: number) => void;
      ragService.ingestDocument.mockReturnValue(
        new Promise<number>((resolve) => {
          release = resolve;
        }),
      );

      const result = await service.upload(buildFile(), 'admin-1');

      expect(result.status).toBe(KnowledgeDocumentStatus.PENDING);
      expect(repo.markReady).not.toHaveBeenCalled();

      release(1);
      await flushPromises();
      expect(repo.markReady).toHaveBeenCalled();
    });
  });

  describe('upload - procesamiento en segundo plano (CA2)', () => {
    it('TXT: marca PROCESSING, vectoriza el texto con el id como origen y marca READY con la cantidad de chunks', async () => {
      const file = buildFile();
      ragService.ingestDocument.mockResolvedValue(3);

      await service.upload(file, 'admin-1');
      await flushPromises();

      const created = repo.create.mock.results[0].value as KnowledgeDocument;
      expect(repo.markProcessing).toHaveBeenCalledWith(created.id);
      expect(ragService.ingestDocument).toHaveBeenCalledWith(
        file.buffer.toString('utf-8'),
        created.id,
      );
      expect(repo.markReady).toHaveBeenCalledWith(created.id, 3);
      expect(repo.markError).not.toHaveBeenCalled();
    });

    it('PDF: extrae el texto con pdf-parse antes de vectorizar', async () => {
      const file = buildFile({
        originalname: 'politicas.pdf',
        mimetype: 'application/pdf',
      });
      pdfParseMock.mockResolvedValue({
        text: 'Se aceptan mascotas de hasta 10 kg.',
      });

      await service.upload(file, 'admin-1');
      await flushPromises();

      const created = repo.create.mock.results[0].value as KnowledgeDocument;
      expect(pdfParseMock).toHaveBeenCalledWith(file.buffer);
      expect(ragService.ingestDocument).toHaveBeenCalledWith(
        'Se aceptan mascotas de hasta 10 kg.',
        created.id,
      );
      expect(repo.markReady).toHaveBeenCalledWith(created.id, 3);
    });

    it('marca ERROR con un mensaje claro si el documento no tiene texto legible (p. ej. un PDF escaneado)', async () => {
      pdfParseMock.mockResolvedValue({ text: '   \n  ' });

      await service.upload(
        buildFile({
          originalname: 'escaneado.pdf',
          mimetype: 'application/pdf',
        }),
        'admin-1',
      );
      await flushPromises();

      const created = repo.create.mock.results[0].value as KnowledgeDocument;
      expect(repo.markError).toHaveBeenCalledWith(
        created.id,
        'El documento no contiene texto legible',
      );
      expect(ragService.ingestDocument).not.toHaveBeenCalled();
      expect(repo.markReady).not.toHaveBeenCalled();
    });

    it('marca ERROR si el texto es demasiado corto para vectorizar', async () => {
      const buffer = Buffer.from('corto');

      await service.upload(
        buildFile({ buffer, size: buffer.length }),
        'admin-1',
      );
      await flushPromises();

      expect(repo.markError).toHaveBeenCalledWith(
        expect.any(String),
        'El documento no contiene texto legible',
      );
    });

    it('marca ERROR con el mensaje del fallo si el PDF está corrupto', async () => {
      pdfParseMock.mockRejectedValue(new Error('Invalid PDF structure'));

      await service.upload(
        buildFile({ originalname: 'roto.pdf', mimetype: 'application/pdf' }),
        'admin-1',
      );
      await flushPromises();

      expect(repo.markError).toHaveBeenCalledWith(
        expect.any(String),
        'Invalid PDF structure',
      );
      expect(repo.markReady).not.toHaveBeenCalled();
    });

    it('marca ERROR si falla la vectorización (p. ej. Gemini sin cuota) y no lo propaga al request', async () => {
      ragService.ingestDocument.mockRejectedValue(
        new Error('429 Too Many Requests'),
      );

      await expect(
        service.upload(buildFile(), 'admin-1'),
      ).resolves.toBeDefined();
      await flushPromises();

      expect(repo.markError).toHaveBeenCalledWith(
        expect.any(String),
        '429 Too Many Requests',
      );
      expect(repo.markReady).not.toHaveBeenCalled();
    });

    it('si la vectorización falla a mitad de camino, borra los chunks ya guardados antes de marcar ERROR', async () => {
      ragService.ingestDocument.mockRejectedValue(
        new Error('429 Too Many Requests'),
      );

      await service.upload(buildFile(), 'admin-1');
      await flushPromises();

      const created = repo.create.mock.results[0].value as KnowledgeDocument;
      expect(ragService.removeDocumentChunks).toHaveBeenCalledWith(created.id);
      expect(
        ragService.removeDocumentChunks.mock.invocationCallOrder[0],
      ).toBeLessThan(repo.markError.mock.invocationCallOrder[0]);
    });

    it('marca ERROR igual aunque falle la limpieza de chunks', async () => {
      ragService.ingestDocument.mockRejectedValue(
        new Error('429 Too Many Requests'),
      );
      ragService.removeDocumentChunks.mockRejectedValue(new Error('db caída'));

      await service.upload(buildFile(), 'admin-1');
      await flushPromises();

      expect(repo.markError).toHaveBeenCalledWith(
        expect.any(String),
        '429 Too Many Requests',
      );
    });

    it('no intenta limpiar chunks si el documento no tenía texto legible (nunca se indexó nada)', async () => {
      const buffer = Buffer.from('corto');

      await service.upload(
        buildFile({ buffer, size: buffer.length }),
        'admin-1',
      );
      await flushPromises();

      expect(ragService.removeDocumentChunks).not.toHaveBeenCalled();
    });

    it('usa "Error desconocido" cuando lo que falla no es un Error', async () => {
      ragService.ingestDocument.mockRejectedValue('boom');

      await service.upload(buildFile(), 'admin-1');
      await flushPromises();

      expect(repo.markError).toHaveBeenCalledWith(
        expect.any(String),
        'Error desconocido',
      );
    });
  });

  describe('remove (CA4)', () => {
    it('lanza NotFoundException si el documento no existe y no borra nada', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.remove('no-existe')).rejects.toThrow(
        new NotFoundException('Documento no encontrado'),
      );
      expect(repo.deleteById).not.toHaveBeenCalled();
      expect(fsPromises.unlink).not.toHaveBeenCalled();
    });

    it('borra el registro (los embeddings caen por cascade) y después el archivo del disco', async () => {
      repo.findById.mockResolvedValue(
        buildDoc({ id: 'doc-1', storagePath: 'doc-1.pdf' }),
      );

      await service.remove('doc-1');

      expect(repo.deleteById).toHaveBeenCalledWith('doc-1');
      expect(fsPromises.unlink).toHaveBeenCalledWith(
        join(UPLOAD_DIR, 'doc-1.pdf'),
      );
      expect(repo.deleteById.mock.invocationCallOrder[0]).toBeLessThan(
        (fsPromises.unlink as jest.Mock).mock.invocationCallOrder[0],
      );
    });

    it('no falla si el archivo ya no estaba en el disco: el registro igual se borró', async () => {
      repo.findById.mockResolvedValue(
        buildDoc({ id: 'doc-1', storagePath: 'doc-1.txt' }),
      );
      (fsPromises.unlink as jest.Mock).mockRejectedValue(
        new Error('ENOENT: no such file or directory'),
      );

      await expect(service.remove('doc-1')).resolves.toBeUndefined();

      expect(repo.deleteById).toHaveBeenCalledWith('doc-1');
      expect(Logger.prototype.warn).toHaveBeenCalled();
    });

    it('no intenta borrar ningún archivo si el documento nunca llegó a guardarse en disco', async () => {
      repo.findById.mockResolvedValue(
        buildDoc({ id: 'doc-1', storagePath: '' }),
      );

      await service.remove('doc-1');

      expect(repo.deleteById).toHaveBeenCalledWith('doc-1');
      expect(fsPromises.unlink).not.toHaveBeenCalled();
    });
  });
  describe('onModuleInit (documentos interrumpidos por un reinicio)', () => {
    it('marca como ERROR los documentos que quedaron PENDING/PROCESSING y limpia sus chunks parciales', async () => {
      repo.findInProgress.mockResolvedValue([
        buildDoc({ id: 'doc-a', status: KnowledgeDocumentStatus.PROCESSING }),
        buildDoc({ id: 'doc-b', status: KnowledgeDocumentStatus.PENDING }),
      ]);

      await service.onModuleInit();

      expect(repo.runInContext).toHaveBeenCalled();
      expect(ragService.removeDocumentChunks).toHaveBeenCalledWith('doc-a');
      expect(ragService.removeDocumentChunks).toHaveBeenCalledWith('doc-b');
      expect(repo.markError).toHaveBeenCalledWith(
        'doc-a',
        expect.stringContaining('interrumpió'),
      );
      expect(repo.markError).toHaveBeenCalledWith(
        'doc-b',
        expect.stringContaining('interrumpió'),
      );
    });

    it('no toca nada si no hay documentos en curso', async () => {
      repo.findInProgress.mockResolvedValue([]);

      await service.onModuleInit();

      expect(repo.markError).not.toHaveBeenCalled();
      expect(ragService.removeDocumentChunks).not.toHaveBeenCalled();
    });

    it('no frena el arranque del server si la revisión falla', async () => {
      repo.findInProgress.mockRejectedValue(new Error('db caída'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });
});
