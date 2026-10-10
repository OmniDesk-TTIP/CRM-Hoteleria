import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getBotToken } from 'nestjs-telegraf';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { AppModule } from './../src/app.module';
import { createValidationPipe } from '../src/validation.config';
import { seedUser, bearer } from './auth.helper';
import {
  User,
  UserRole,
} from '../src/infrastructure/database/entities/User.entity';
import { Document } from '../src/infrastructure/database/entities/Document.entity';
import { KnowledgeDocument } from '../src/infrastructure/database/entities/KnowledgeDocument.entity';
import { MAX_UPLOAD_BYTES } from '../src/modules/documents/documents.model';

const MARKER = 'E2E-DOC-MARKER';
const FAIL_MARKER = 'E2E-FAIL';
const RUN = Date.now();
const UNIQUE = `${MARKER}-${RUN}`;
const UPLOAD_DIR = join(tmpdir(), `crm-e2e-docs-${RUN}`);
process.env.UPLOAD_DIR = UPLOAD_DIR;

const mockEmbedContent = jest.fn();
const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn();
const mockPdfParse = jest.fn();

jest.mock('@google/generative-ai', () => {
  const actual = jest.requireActual('@google/generative-ai');
  return {
    ...actual,
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
      getGenerativeModel: (config: { model: string }) =>
        mockGetGenerativeModel(config),
    })),
  };
});

jest.mock('pdf-parse', () => (buffer: Buffer) => mockPdfParse(buffer));

const defaultEmbed = (text: string) => {
  if (text.includes(FAIL_MARKER)) {
    return Promise.reject(new Error('Gemini no disponible (simulado)'));
  }
  const values: number[] = Array(3072).fill(0.001);
  if (text.includes(MARKER)) {
    values.fill(0);
    values[text.includes('-SPA') ? 1 : 0] = 1;
  }
  return Promise.resolve({ embedding: { values } });
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface DocumentBody {
  id: string;
  filename: string;
  mimeType: string;
  type: 'PDF' | 'TXT';
  sizeBytes: number;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'ERROR';
  chunksCount: number;
  errorMessage?: string;
  createdAt: string;
}

/**
 * Solo lo propio de HTTP: autenticación y roles, la subida multipart (nombre con tildes, 400, 413),
 * la baja, y el RagService de verdad (chunks vinculados al documento, que Chamber use y deje de usar
 * lo que se sube o se borra). Las reglas del service (validaciones, estados y errores) se prueban en
 * src/modules/documents/documents.service.integration-spec.ts.
 */
describe('Admin Documents - base de conocimiento (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let admin: Awaited<ReturnType<typeof seedUser>>;
  let employee: Awaited<ReturnType<typeof seedUser>>;

  const createdDocIds: string[] = [];

  const http = () => request(app.getHttpServer());

  const upload = async (
    content: string | Buffer,
    filename: string,
    contentType: string,
  ) => {
    const res = await http()
      .post('/admin/documents')
      .set('Authorization', bearer(admin.accessToken))
      .attach(
        'file',
        Buffer.isBuffer(content) ? content : Buffer.from(content),
        {
          filename,
          contentType,
        },
      );
    if (res.status === 201) createdDocIds.push((res.body as DocumentBody).id);
    return res;
  };

  const listDocuments = async (): Promise<DocumentBody[]> => {
    const res = await http()
      .get('/admin/documents')
      .set('Authorization', bearer(admin.accessToken))
      .expect(200);
    return res.body as DocumentBody[];
  };

  const waitForStatus = async (
    id: string,
    expected: DocumentBody['status'],
    timeoutMs = 8000,
  ): Promise<DocumentBody> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const doc = (await listDocuments()).find((d) => d.id === id);
      if (doc?.status === expected) return doc;
      await sleep(100);
    }
    throw new Error(`El documento ${id} no llegó al estado ${expected}`);
  };

  const countChunksOfSource = (id: string) =>
    em.count(Document, { sourceDocument: { id } });

  const lastChatSystemInstruction = (): string => {
    const configs = mockGetGenerativeModel.mock.calls
      .map(
        ([config]) => config as { model: string; systemInstruction?: string },
      )
      .filter((config) => config.model !== 'gemini-embedding-2');
    return configs[configs.length - 1]?.systemInstruction ?? '';
  };

  beforeAll(async () => {
    mockEmbedContent.mockImplementation(defaultEmbed);
    mockGetGenerativeModel.mockImplementation((config: { model: string }) =>
      config.model === 'gemini-embedding-2'
        ? { embedContent: mockEmbedContent }
        : { generateContent: mockGenerateContent },
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
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
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    em = app.get(MikroORM).em.fork();
    admin = await seedUser(app, em, UserRole.ADMIN);
    employee = await seedUser(app, em, UserRole.EMPLOYEE);
  });

  beforeEach(() => {
    mockEmbedContent.mockImplementation(defaultEmbed);
    mockPdfParse.mockReset();
    mockGenerateContent.mockResolvedValue({
      response: { functionCalls: () => [], text: () => 'Respuesta simulada' },
    });
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(KnowledgeDocument, {
        $or: [
          { id: { $in: createdDocIds } },
          { uploadedById: { $in: [admin.user.id, employee.user.id] } },
        ],
      });
      await em.nativeDelete(Document, { content: { $like: `%${MARKER}%` } });
      await em.nativeDelete(Document, {
        content: { $like: `%${FAIL_MARKER}%` },
      });
      await em.nativeDelete(User, {
        id: { $in: [admin.user.id, employee.user.id] },
      });
    } finally {
      rmSync(UPLOAD_DIR, { recursive: true, force: true });
      await app.close();
    }
  });

  describe('CA6 - seguridad', () => {
    it('GET /admin/documents sin token responde 401', async () => {
      await http().get('/admin/documents').expect(401);
    });

    it('POST /admin/documents sin token responde 401', async () => {
      await http()
        .post('/admin/documents')
        .attach('file', Buffer.from('hola'), {
          filename: 'x.txt',
          contentType: 'text/plain',
        })
        .expect(401);
    });

    it('un EMPLOYEE no puede listar (403)', async () => {
      await http()
        .get('/admin/documents')
        .set('Authorization', bearer(employee.accessToken))
        .expect(403);
    });

    it('un EMPLOYEE no puede subir (403) y no se crea nada', async () => {
      const filename = `empleado-${RUN}.txt`;

      await http()
        .post('/admin/documents')
        .set('Authorization', bearer(employee.accessToken))
        .attach('file', Buffer.from('contenido'), {
          filename,
          contentType: 'text/plain',
        })
        .expect(403);

      em.clear();
      expect(await em.count(KnowledgeDocument, { filename })).toBe(0);
    });

    it('un EMPLOYEE no puede eliminar (403)', async () => {
      await http()
        .delete('/admin/documents/3f1c1d0e-5b7a-4a52-9d58-0d7f4f6f9a11')
        .set('Authorization', bearer(employee.accessToken))
        .expect(403);
    });
  });

  describe('CA1 - carga de archivos', () => {
    it('sube un TXT y responde 201 con el documento en PENDING', async () => {
      const content = `Check-in desde las 14:00. ${UNIQUE}-TXT`;

      const res = await upload(content, `reglas-${RUN}.txt`, 'text/plain');

      expect(res.status).toBe(201);
      const body = res.body as DocumentBody;
      expect(body).toMatchObject({
        filename: `reglas-${RUN}.txt`,
        type: 'TXT',
        mimeType: 'text/plain',
        sizeBytes: Buffer.byteLength(content),
        status: 'PENDING',
        chunksCount: 0,
      });
      expect(new Date(body.createdAt).toString()).not.toBe('Invalid Date');
      expect(body).not.toHaveProperty('storagePath');
    });

    it('rechaza un formato no soportado con 400 y un mensaje claro, sin crear el documento', async () => {
      const filename = `foto-${RUN}.png`;

      const res = await upload(
        Buffer.from('no-soy-un-pdf'),
        filename,
        'image/png',
      );

      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toBe(
        'Formato no soportado. Solo se aceptan PDF y TXT.',
      );
      em.clear();
      expect(await em.count(KnowledgeDocument, { filename })).toBe(0);
    });

    it('responde 400 si no se adjunta ningún archivo', async () => {
      const res = await http()
        .post('/admin/documents')
        .set('Authorization', bearer(admin.accessToken))
        .send({})
        .expect(400);

      expect((res.body as { message: string }).message).toBe(
        'Adjuntá un archivo PDF o TXT',
      );
    });

    it('responde 413 con un mensaje en español si el archivo supera el tamaño máximo', async () => {
      const res = await upload(
        Buffer.alloc(MAX_UPLOAD_BYTES + 1, 'a'),
        `enorme-${RUN}.txt`,
        'text/plain',
      );

      expect(res.status).toBe(413);
      expect((res.body as { message: string }).message).toBe(
        `El archivo supera el tamaño máximo permitido (${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`,
      );
    });

    it('conserva las tildes y la ñ en el nombre del archivo', async () => {
      const filename = `Políticas de cancelación ${RUN}.txt`;

      const res = await upload(
        `Regla ${UNIQUE}-TILDES`,
        filename,
        'text/plain',
      );

      expect(res.status).toBe(201);
      expect((res.body as DocumentBody).filename).toBe(filename);
    });
  });

  describe('CA2 - indicador de procesamiento', () => {
    it('un TXT pasa de PENDING a READY y deja sus chunks vinculados al documento', async () => {
      const res = await upload(
        `El gimnasio abre de 7 a 22 hs. ${UNIQUE}-GYM`,
        `gimnasio-${RUN}.txt`,
        'text/plain',
      );
      const { id } = res.body as DocumentBody;

      const ready = await waitForStatus(id, 'READY');

      expect(ready.chunksCount).toBe(1);
      expect(ready.errorMessage).toBeUndefined();
      em.clear();
      expect(await countChunksOfSource(id)).toBe(1);
    });

    it('si la vectorización falla a mitad de camino no deja chunks parciales', async () => {
      const prefix = `${UNIQUE}-PARCIAL `;
      const text =
        prefix +
        'a'.repeat(1500 - prefix.length) +
        FAIL_MARKER +
        'b'.repeat(200);

      const res = await upload(text, `parcial-${RUN}.txt`, 'text/plain');
      const { id } = res.body as DocumentBody;

      await waitForStatus(id, 'ERROR');

      em.clear();
      expect(await countChunksOfSource(id)).toBe(0);
      expect(
        await em.count(Document, { content: { $like: `%${UNIQUE}-PARCIAL%` } }),
      ).toBe(0);
    });
  });

  describe('CA4 - eliminación', () => {
    it('elimina el documento, sus embeddings y el archivo del disco (204)', async () => {
      const res = await upload(
        `El desayuno es de 7 a 10 hs. ${UNIQUE}-DESAYUNO`,
        `desayuno-${RUN}.txt`,
        'text/plain',
      );
      const { id } = res.body as DocumentBody;
      await waitForStatus(id, 'READY');
      em.clear();
      expect(await countChunksOfSource(id)).toBeGreaterThan(0);
      expect(existsSync(join(UPLOAD_DIR, `${id}.txt`))).toBe(true);

      await http()
        .delete(`/admin/documents/${id}`)
        .set('Authorization', bearer(admin.accessToken))
        .expect(204);

      em.clear();
      expect(await em.count(KnowledgeDocument, { id })).toBe(0);
      expect(await countChunksOfSource(id)).toBe(0);
      expect(
        await em.count(Document, {
          content: { $like: `%${UNIQUE}-DESAYUNO%` },
        }),
      ).toBe(0);
      expect(existsSync(join(UPLOAD_DIR, `${id}.txt`))).toBe(false);
      expect((await listDocuments()).map((d) => d.id)).not.toContain(id);
    });

    it('responde 404 si el documento no existe', async () => {
      const res = await http()
        .delete('/admin/documents/3f1c1d0e-5b7a-4a52-9d58-0d7f4f6f9a11')
        .set('Authorization', bearer(admin.accessToken))
        .expect(404);

      expect((res.body as { message: string }).message).toBe(
        'Documento no encontrado',
      );
    });

    it('responde 400 si el id no es un UUID', async () => {
      await http()
        .delete('/admin/documents/no-es-un-uuid')
        .set('Authorization', bearer(admin.accessToken))
        .expect(400);
    });

    it('un documento eliminado mientras se procesa no deja chunks huérfanos', async () => {
      let release!: (value: { text: string }) => void;
      mockPdfParse.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );

      const res = await upload(
        Buffer.from('%PDF-1.4 simulado'),
        `en-proceso-${RUN}.pdf`,
        'application/pdf',
      );
      const { id } = res.body as DocumentBody;
      await waitForStatus(id, 'PROCESSING');

      await http()
        .delete(`/admin/documents/${id}`)
        .set('Authorization', bearer(admin.accessToken))
        .expect(204);

      release({ text: `Regla que ya no debe indexarse ${UNIQUE}-HUERFANO` });
      await sleep(700);

      em.clear();
      expect(
        await em.count(Document, {
          content: { $like: `%${UNIQUE}-HUERFANO%` },
        }),
      ).toBe(0);
    });
  });

  describe('CA5 - reflejo en el bot sin reiniciar', () => {
    it('Chamber usa el documento apenas se indexa y deja de usarlo apenas se elimina', async () => {
      const fact = `El spa atiende de 9 a 21 hs. ${UNIQUE}-SPA`;
      const question = `¿A qué hora abre el spa? ${UNIQUE}-SPA`;

      const res = await upload(fact, `spa-${RUN}.txt`, 'text/plain');
      const { id } = res.body as DocumentBody;
      await waitForStatus(id, 'READY');

      await http().post('/rag/ask').send({ question }).expect(200);
      expect(lastChatSystemInstruction()).toContain(fact);

      await http()
        .delete(`/admin/documents/${id}`)
        .set('Authorization', bearer(admin.accessToken))
        .expect(204);

      await http().post('/rag/ask').send({ question }).expect(200);
      expect(lastChatSystemInstruction()).not.toContain(fact);
    });
  });
});
