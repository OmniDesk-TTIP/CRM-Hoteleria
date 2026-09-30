import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { getBotToken } from 'nestjs-telegraf';
import { AppModule } from './../src/app.module';
import { RagService } from '../src/modules/rag/rag.service';
import { createValidationPipe } from '../src/validation.config';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { seedUser, bearer } from './auth.helper';
import { User, UserRole } from '../src/infrastructure/database/entities/User.entity';

describe('ValidationPipe global (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  // /rag/ingest quedó detrás de @Roles(ADMIN): sin token daría 401 y nunca llegaría
  // al ValidationPipe, que es lo que esta suite quiere ejercitar.
  let adminToken: string;
  let adminId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RagService)
      .useValue({ ingestDocument: jest.fn().mockResolvedValue(undefined), askQuestion: jest.fn().mockResolvedValue({}) })
      .overrideProvider(getBotToken())
      .useValue({ launch: jest.fn(), stop: jest.fn(), on: jest.fn(), start: jest.fn(), use: jest.fn() })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    em = app.get(MikroORM).em.fork();
    const admin = await seedUser(app, em, UserRole.ADMIN);
    adminToken = admin.accessToken;
    adminId = admin.user.id;
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(User, { id: adminId });
      if (app) await app.close();
    } catch (e) {
    }
  });

  it('rechaza POST /rag/ingest con un texto más corto que el mínimo (400)', async () => {
    const response = await request(app.getHttpServer())
      .post('/rag/ingest')
      .set('Authorization', bearer(adminToken))
      .send({ text: 'corto' })
      .expect(400);

    expect(response.body.message).toContain('mínimo 10 caracteres');
  });

  it('rechaza POST /rag/ingest sin el campo text (400)', async () => {
    await request(app.getHttpServer())
      .post('/rag/ingest')
      .set('Authorization', bearer(adminToken))
      .send({})
      .expect(400);
  });

  it('rechaza POST /rag/ask con una pregunta más corta que el mínimo (400)', async () => {
    const response = await request(app.getHttpServer())
      .post('/rag/ask')
      .send({ question: 'hola' })
      .expect(400);

    expect(response.body.message).toContain('al menos 5 caracteres');
  });

  it('rechaza POST /rag/ask con campos no declarados en el DTO (400)', async () => {
    await request(app.getHttpServer())
      .post('/rag/ask')
      .send({ question: '¿Cuál es el horario del hotel?', campoExtra: 'no debería existir' })
      .expect(400);
  });

  it('acepta POST /rag/ask con un payload válido (200)', async () => {
    await request(app.getHttpServer())
      .post('/rag/ask')
      .send({ question: '¿Cuáles son los horarios del hotel?' })
      .expect(200);
  });
});
