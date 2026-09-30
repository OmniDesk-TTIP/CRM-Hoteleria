import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { getBotToken } from 'nestjs-telegraf';

describe('AppModule (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getBotToken())
      .useValue({
        launch: jest.fn(),
        stop: jest.fn(),
        on: jest.fn(),
        use: jest.fn(),
        start: jest.fn(),
        hears: jest.fn(),
        action: jest.fn(),
        command: jest.fn(),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    try {
      await app?.close();
    } catch (error) {
    }
  });

  it('debería levantar el servidor (GET /)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200); 
  });
});