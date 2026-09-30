import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { getBotToken } from 'nestjs-telegraf';
import { AppModule } from './../src/app.module';
import { createValidationPipe } from '../src/validation.config';
import { Document } from '../src/infrastructure/database/entities/Document.entity';
import { seedUser, bearer } from './auth.helper';
import { User, UserRole } from '../src/infrastructure/database/entities/User.entity';

jest.mock('@google/generative-ai', () => {
  const actual = jest.requireActual('@google/generative-ai');
  return {
    ...actual,
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
      getGenerativeModel: jest.fn().mockReturnValue({
        embedContent: jest.fn().mockResolvedValue({ embedding: { values: Array(3072).fill(0.001) } }),
      }),
    })),
  };
});

describe('RagModule - ingest (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  // La ingesta escribe en la base de conocimiento del bot: solo un ADMIN puede.
  let adminToken: string;
  let adminId: string;

  const text = 'Texto de prueba para vectorizar en el e2e de ingesta.';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getBotToken())
      .useValue({ launch: jest.fn(), stop: jest.fn(), on: jest.fn(), start: jest.fn(), use: jest.fn() })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    const orm = app.get(MikroORM);
    em = orm.em.fork();

    const admin = await seedUser(app, em, UserRole.ADMIN);
    adminToken = admin.accessToken;
    adminId = admin.user.id;
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(Document, { content: text });
      await em.nativeDelete(User, { id: adminId });
      if (app) await app.close();
    } catch (e) {
    }
  });

  it('POST /rag/ingest debería vectorizar el texto y persistirlo como Document en la base', async () => {
    const response = await request(app.getHttpServer())
      .post('/rag/ingest')
      .set('Authorization', bearer(adminToken))
      .send({ text })
      .expect(200);

    expect(response.body).toEqual({
      message: 'Documento particionado, vectorizado y guardado con éxito.',
      status: 'success',
    });

    em.clear();
    const saved = await em.findOne(Document, { content: text });

    expect(saved).toBeDefined();
    expect(saved?.embedding).toBeDefined();
  });
});
