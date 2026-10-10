import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  INestApplication,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getBotToken } from 'nestjs-telegraf';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { AppModule } from '../../app.module';
import { RagService } from '../rag/rag.service';
import { DocumentsService } from './documents.service';
import { DocumentsRepository } from './documents.repository';
import { MAX_UPLOAD_BYTES } from './documents.model';
import {
  KnowledgeDocument,
  KnowledgeDocumentStatus,
  KnowledgeDocumentType,
} from '../../infrastructure/database/entities/KnowledgeDocument.entity';

const RUN = Date.now();
const UPLOAD_DIR = join(tmpdir(), `crm-int-docs-${RUN}`);
process.env.UPLOAD_DIR = UPLOAD_DIR;

const mockPdfParse = jest.fn();
jest.mock('pdf-parse', () => (buffer: Buffer) => mockPdfParse(buffer));

/**
 * Integración de DocumentsService contra la base de test y un directorio temporal: registros y
 * archivos son reales. Gemini (RagService) y pdf-parse están simulados; que los chunks queden
 * realmente vinculados al documento lo prueba el e2e, que usa el RagService de verdad.
 */
describe('DocumentsService (integración)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let em: EntityManager;
  let service: DocumentsService;
  let repo: DocumentsRepository;

  const ingestDocument = jest.fn();
  const removeDocumentChunks = jest.fn();

  const USER_ID = randomUUID();
  const createdIds: string[] = [];
  let seq = 0;
  const name = (ext: string) => `doc-${RUN}-${++seq}.${ext}`;

  const TEXT = 'Check-in desde las 14:00. Desayuno de 7 a 10 hs.';

  const file = (
    originalname: string,
    content: string | Buffer = TEXT,
    overrides: Partial<{ mimetype: string; size: number }> = {},
  ) => {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    return {
      originalname,
      mimetype: 'text/plain',
      size: buffer.length,
      buffer,
      ...overrides,
    };
  };

  const upload = async (...args: Parameters<typeof file>) => {
    const dto = await service.upload(file(...args), USER_ID);
    createdIds.push(dto.id);
    return dto;
  };

  const rowOf = (id: string) => em.fork().findOne(KnowledgeDocument, { id });

  /** La vectorización corre en segundo plano: se espera hasta que el documento queda READY o ERROR. */
  const waitForFinal = async (id: string): Promise<KnowledgeDocument> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5000) {
      const row = await rowOf(id);
      if (
        row?.status === KnowledgeDocumentStatus.READY ||
        row?.status === KnowledgeDocumentStatus.ERROR
      ) {
        return row;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`El documento ${id} no terminó de procesarse`);
  };

  const countByFilename = (filename: string) =>
    em.fork().count(KnowledgeDocument, { filename });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RagService)
      .useValue({
        ingestDocument,
        removeDocumentChunks,
        askQuestion: jest.fn(),
      })
      .overrideProvider(getBotToken())
      .useValue({
        launch: jest.fn(),
        stop: jest.fn(),
        on: jest.fn(),
        start: jest.fn(),
        use: jest.fn(),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    orm = app.get(MikroORM);
    em = orm.em.fork();
    service = app.get(DocumentsService);
    repo = app.get(DocumentsRepository);
  });

  beforeEach(() => {
    orm.em.clear();
    ingestDocument.mockReset();
    ingestDocument.mockResolvedValue(1);
    removeDocumentChunks.mockReset();
    removeDocumentChunks.mockResolvedValue(undefined);
    mockPdfParse.mockReset();
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(KnowledgeDocument, { id: { $in: createdIds } });
      await em.nativeDelete(KnowledgeDocument, { uploadedById: USER_ID });
    } finally {
      rmSync(UPLOAD_DIR, { recursive: true, force: true });
      await app.close();
    }
  });

  describe('list (CA3)', () => {
    it('lista del más reciente al más viejo, con lo que necesita el panel y sin datos internos', async () => {
      const first = await upload(name('txt'));
      await new Promise((resolve) => setTimeout(resolve, 30));
      const second = await upload(name('txt'));

      const docs = (await service.list()).filter((doc) =>
        [first.id, second.id].includes(doc.id),
      );

      expect(docs.map((doc) => doc.id)).toEqual([second.id, first.id]);
      expect(docs[1]).toMatchObject({
        filename: first.filename,
        type: 'TXT',
        mimeType: 'text/plain',
        sizeBytes: Buffer.byteLength(TEXT),
      });
      expect(new Date(docs[1].createdAt).toISOString()).toBe(docs[1].createdAt);
      expect(docs[1]).not.toHaveProperty('storagePath');
      expect(docs[1]).not.toHaveProperty('uploadedById');
    });
  });

  describe('upload - validación (CA1)', () => {
    it('rechaza un archivo que supera el tamaño máximo y no crea nada', async () => {
      const filename = name('txt');

      await expect(
        service.upload(
          file(filename, TEXT, { size: MAX_UPLOAD_BYTES + 1 }),
          USER_ID,
        ),
      ).rejects.toThrow(/tamaño máximo/);

      expect(await countByFilename(filename)).toBe(0);
    });

    it.each(['foto.png', 'reglas.docx', 'programa.exe', 'sin-extension'])(
      'rechaza el formato no soportado de "%s" y no crea nada',
      async (original) => {
        const filename = `${RUN}-${original}`;

        const attempt = service.upload(file(filename), USER_ID);

        await expect(attempt).rejects.toThrow(BadRequestException);
        await expect(attempt).rejects.toThrow(
          'Formato no soportado. Solo se aceptan PDF y TXT.',
        );
        expect(await countByFilename(filename)).toBe(0);
      },
    );

    it('acepta la extensión en mayúsculas y normaliza el mimetype genérico que manda el cliente', async () => {
      const dto = await upload(name('TXT'), TEXT, {
        mimetype: 'application/octet-stream',
      });

      expect(dto).toMatchObject({ type: 'TXT', mimeType: 'text/plain' });
      expect((await rowOf(dto.id))?.storagePath).toBe(`${dto.id}.txt`);
    });
  });

  describe('upload - guardado (CA2)', () => {
    it('crea el registro PENDING, guarda el archivo y responde sin esperar la vectorización', async () => {
      let release!: (chunks: number) => void;
      ingestDocument.mockReturnValue(
        new Promise<number>((resolve) => {
          release = resolve;
        }),
      );

      const dto = await upload(name('txt'));

      expect(dto).toMatchObject({
        status: KnowledgeDocumentStatus.PENDING,
        chunksCount: 0,
        type: KnowledgeDocumentType.TXT,
        sizeBytes: Buffer.byteLength(TEXT),
      });
      const row = await rowOf(dto.id);
      expect(row).toMatchObject({
        uploadedById: USER_ID,
        storagePath: `${dto.id}.txt`,
      });
      expect(readFileSync(join(UPLOAD_DIR, `${dto.id}.txt`), 'utf-8')).toBe(
        TEXT,
      );

      release(1);
      await waitForFinal(dto.id);
    });

    it('si no se puede guardar el archivo, elimina el registro y responde 500 sin procesar nada', async () => {
      const filename = name('txt');
      // una carpeta de destino que en realidad es un archivo: no se puede crear ni escribir ahí
      rmSync(UPLOAD_DIR, { recursive: true, force: true });
      writeFileSync(UPLOAD_DIR, 'no soy una carpeta');

      try {
        await expect(service.upload(file(filename), USER_ID)).rejects.toThrow(
          InternalServerErrorException,
        );
      } finally {
        rmSync(UPLOAD_DIR, { force: true });
        mkdirSync(UPLOAD_DIR, { recursive: true });
      }

      expect(await countByFilename(filename)).toBe(0);
      expect(ingestDocument).not.toHaveBeenCalled();
    });
  });

  describe('procesamiento en segundo plano (CA2)', () => {
    it('TXT: pasa a READY con la cantidad de chunks y vectoriza el texto con el id como origen', async () => {
      ingestDocument.mockResolvedValue(3);

      const dto = await upload(name('txt'));
      const row = await waitForFinal(dto.id);

      expect(row).toMatchObject({
        status: KnowledgeDocumentStatus.READY,
        chunksCount: 3,
      });
      expect(row.errorMessage).toBeNull();
      expect(ingestDocument).toHaveBeenCalledWith(TEXT, dto.id);
    });

    it('PDF: vectoriza el texto que extrae pdf-parse', async () => {
      mockPdfParse.mockResolvedValue({ text: 'La pileta cierra a las 20 hs.' });

      const dto = await upload(name('pdf'), Buffer.from('%PDF-1.4 simulado'), {
        mimetype: 'application/pdf',
      });
      const row = await waitForFinal(dto.id);

      expect(dto).toMatchObject({ type: 'PDF', mimeType: 'application/pdf' });
      expect(row.status).toBe(KnowledgeDocumentStatus.READY);
      expect(ingestDocument).toHaveBeenCalledWith(
        'La pileta cierra a las 20 hs.',
        dto.id,
      );
    });

    it.each([
      ['un PDF escaneado (solo espacios)', 'pdf', '   '],
      ['un TXT demasiado corto', 'txt', 'hola'],
    ])(
      'queda en ERROR con un mensaje claro si es %s, sin vectorizar ni limpiar nada',
      async (_label, ext, text) => {
        mockPdfParse.mockResolvedValue({ text });

        const dto = await upload(
          name(ext),
          ext === 'pdf' ? Buffer.from('%PDF-1.4') : text,
        );
        const row = await waitForFinal(dto.id);

        expect(row.status).toBe(KnowledgeDocumentStatus.ERROR);
        expect(row.errorMessage).toBe('El documento no contiene texto legible');
        expect(
          (await service.list()).find((doc) => doc.id === dto.id)?.errorMessage,
        ).toBe('El documento no contiene texto legible');
        expect(ingestDocument).not.toHaveBeenCalled();
        expect(removeDocumentChunks).not.toHaveBeenCalled();
      },
    );

    it('PDF corrupto: queda en ERROR con el mensaje del fallo', async () => {
      mockPdfParse.mockRejectedValue(new Error('Invalid PDF structure'));

      const dto = await upload(name('pdf'), Buffer.from('basura'), {
        mimetype: 'application/pdf',
      });
      const row = await waitForFinal(dto.id);

      expect(row.status).toBe(KnowledgeDocumentStatus.ERROR);
      expect(row.errorMessage).toBe('Invalid PDF structure');
    });

    it('si falla la vectorización: ERROR con el motivo recortado a 500, sin propagarlo y limpiando los chunks parciales', async () => {
      ingestDocument.mockRejectedValue(
        new Error(`Gemini sin cuota ${'x'.repeat(600)}`),
      );

      const dto = await upload(name('txt'));
      const row = await waitForFinal(dto.id);

      expect(row.status).toBe(KnowledgeDocumentStatus.ERROR);
      expect(row.errorMessage).toHaveLength(500);
      expect(row.errorMessage).toMatch(/^Gemini sin cuota/);
      expect(removeDocumentChunks).toHaveBeenCalledWith(dto.id);
    });

    it('queda en ERROR igual si además falla la limpieza de chunks', async () => {
      ingestDocument.mockRejectedValue(new Error('Gemini caído'));
      removeDocumentChunks.mockRejectedValue(new Error('base caída'));

      const dto = await upload(name('txt'));
      const row = await waitForFinal(dto.id);

      expect(row).toMatchObject({
        status: KnowledgeDocumentStatus.ERROR,
        errorMessage: 'Gemini caído',
      });
    });

    it('usa "Error desconocido" cuando lo que falla no es un Error', async () => {
      ingestDocument.mockRejectedValue('boom');

      const dto = await upload(name('txt'));
      const row = await waitForFinal(dto.id);

      expect(row.errorMessage).toBe('Error desconocido');
    });
  });

  describe('remove (CA4)', () => {
    it('borra el registro y el archivo del disco', async () => {
      const dto = await upload(name('txt'));
      await waitForFinal(dto.id);
      expect(existsSync(join(UPLOAD_DIR, `${dto.id}.txt`))).toBe(true);

      await service.remove(dto.id);

      expect(await rowOf(dto.id)).toBeNull();
      expect(existsSync(join(UPLOAD_DIR, `${dto.id}.txt`))).toBe(false);
    });

    it('no falla si el archivo ya no estaba en el disco: el registro igual se borra', async () => {
      const dto = await upload(name('txt'));
      await waitForFinal(dto.id);
      rmSync(join(UPLOAD_DIR, `${dto.id}.txt`));

      await expect(service.remove(dto.id)).resolves.toBeUndefined();

      expect(await rowOf(dto.id)).toBeNull();
    });

    it('lanza NotFound si el documento no existe', async () => {
      await expect(service.remove(randomUUID())).rejects.toThrow(
        new NotFoundException('Documento no encontrado'),
      );
    });
  });

  describe('onModuleInit (documentos interrumpidos por un reinicio)', () => {
    const seed = (status: KnowledgeDocumentStatus) => {
      const doc = em.create(KnowledgeDocument, {
        filename: name('txt'),
        mimeType: 'text/plain',
        type: KnowledgeDocumentType.TXT,
        sizeBytes: 10,
        storagePath: '',
        uploadedById: USER_ID,
        status,
      });
      em.persist(doc);
      return doc;
    };

    it('marca ERROR lo que quedó PENDING o PROCESSING y limpia sus chunks parciales, sin tocar lo terminado', async () => {
      const pending = seed(KnowledgeDocumentStatus.PENDING);
      const processing = seed(KnowledgeDocumentStatus.PROCESSING);
      const ready = seed(KnowledgeDocumentStatus.READY);
      await em.flush();

      await service.onModuleInit();

      for (const doc of [pending, processing]) {
        expect(await rowOf(doc.id)).toMatchObject({
          status: KnowledgeDocumentStatus.ERROR,
          errorMessage: expect.stringContaining('se interrumpió') as string,
        });
        expect(removeDocumentChunks).toHaveBeenCalledWith(doc.id);
      }
      expect((await rowOf(ready.id))?.status).toBe(
        KnowledgeDocumentStatus.READY,
      );
      expect(removeDocumentChunks).not.toHaveBeenCalledWith(ready.id);
    });

    it('no frena el arranque del server si la revisión falla', async () => {
      jest
        .spyOn(repo, 'findInProgress')
        .mockRejectedValueOnce(new Error('base caída'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });
});
