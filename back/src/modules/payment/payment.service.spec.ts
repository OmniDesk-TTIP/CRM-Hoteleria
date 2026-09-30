import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getBotToken } from 'nestjs-telegraf';
import { PaymentService } from './payment.service';
import { ChatService } from '../chat/chat.service';
import { PaymentRepository } from './payment.repository';

jest.mock('mercadopago', () => {
  const createMock = jest.fn();
  const getPaymentMock = jest.fn();
  const validateMock = jest.fn();
  return {
    MercadoPagoConfig: jest.fn().mockImplementation(() => ({})),
    Preference: jest.fn().mockImplementation(() => ({ create: createMock })),
    Payment: jest.fn().mockImplementation(() => ({ get: getPaymentMock })),
    WebhookSignatureValidator: { validate: validateMock },
    __mocks: { createMock, getPaymentMock, validateMock },
  };
});

const { createMock, getPaymentMock, validateMock } = (jest.requireMock('mercadopago') as any).__mocks as {
  createMock: jest.Mock;
  getPaymentMock: jest.Mock;
  validateMock: jest.Mock;
};

describe('PaymentService', () => {
  let service: PaymentService;
  let botMock: { telegram: { sendMessage: jest.Mock } };
  let paymentRepositoryMock: {
    findReservationById: jest.Mock;
    confirmIfPending: jest.Mock;
    findExpiredPendingReservations: jest.Mock;
    cancelExpiredReservations: jest.Mock;
  };

  const configValues: Record<string, string | undefined> = {
    MERCADOPAGO_ACCESS_TOKEN: 'TEST-fake-token',
    MERCADOPAGO_WEBHOOK_SECRET: 'fake-secret',
    APP_BASE_URL: 'https://example.com',
  };

  const buildModule = async (overrides: Record<string, string | undefined> = {}) => {
    const values = { ...configValues, ...overrides };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: ConfigService, useValue: { get: jest.fn((key: string) => values[key]) } },
        { provide: PaymentRepository, useValue: paymentRepositoryMock },
        { provide: getBotToken(), useValue: botMock },
        // El aviso de pago acreditado también queda en el hilo del panel (US-11).
        {
          provide: ChatService,
          useValue: {
            getOrCreateSession: jest.fn().mockResolvedValue({ id: 'chat-1', telegramUserId: '123' }),
            recordSystemMessage: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    return module;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    botMock = { telegram: { sendMessage: jest.fn().mockResolvedValue(undefined) } };
    paymentRepositoryMock = {
      findReservationById: jest.fn(),
      confirmIfPending: jest.fn(),
      findExpiredPendingReservations: jest.fn().mockResolvedValue([]),
      cancelExpiredReservations: jest.fn(),
    };
  });

  it('lanza un error en el constructor si falta MERCADOPAGO_ACCESS_TOKEN', async () => {
    await expect(buildModule({ MERCADOPAGO_ACCESS_TOKEN: undefined })).rejects.toThrow('Falta MERCADOPAGO_ACCESS_TOKEN');
  });

  it('lanza un error en el constructor si falta MERCADOPAGO_WEBHOOK_SECRET', async () => {
    await expect(buildModule({ MERCADOPAGO_WEBHOOK_SECRET: undefined })).rejects.toThrow('Falta MERCADOPAGO_WEBHOOK_SECRET');
  });

  describe('createPreference', () => {
    const reservation: any = {
      id: 'reservation-1',
      depositAmount: 150,
      room: { category: { name: 'Suite' } },
    };
    const guestData = { fullName: 'Juan Pérez', dni: '30111222' };

    it('crea la preferencia con el monto de la seña y los datos del huésped', async () => {
      createMock.mockResolvedValue({ id: 'pref-1', init_point: 'https://mp.example/pref-1' });

      const module = await buildModule();
      service = module.get<PaymentService>(PaymentService);

      const result = await service.createPreference(reservation, guestData as any);

      expect(result).toEqual({ preferenceId: 'pref-1', initPoint: 'https://mp.example/pref-1' });
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            items: [expect.objectContaining({ id: 'reservation-1', unit_price: 150, currency_id: 'ARS' })],
            payer: expect.objectContaining({
              name: 'Juan Pérez',
              identification: { type: 'DNI', number: '30111222' },
            }),
            external_reference: 'reservation-1',
            notification_url: 'https://example.com/payment/webhook',
          }),
        }),
      );
    });

    it('lanza un error si Mercado Pago no devuelve id o init_point', async () => {
      createMock.mockResolvedValue({});

      const module = await buildModule();
      service = module.get<PaymentService>(PaymentService);

      await expect(service.createPreference(reservation, guestData as any)).rejects.toThrow(
        'Mercado Pago no devolvió una preferencia válida',
      );
    });
  });

  describe('getPayment', () => {
    it('delega en el cliente Payment del SDK', async () => {
      getPaymentMock.mockResolvedValue({ id: 123, status: 'approved' });

      const module = await buildModule();
      service = module.get<PaymentService>(PaymentService);

      const result = await service.getPayment('123');

      expect(getPaymentMock).toHaveBeenCalledWith({ id: '123' });
      expect(result).toEqual({ id: 123, status: 'approved' });
    });
  });

  describe('verifyWebhookSignature', () => {
    it('devuelve true cuando la validación del SDK no lanza error', async () => {
      validateMock.mockImplementation(() => undefined);

      const module = await buildModule();
      service = module.get<PaymentService>(PaymentService);

      const result = service.verifyWebhookSignature('ts=1,v1=abc', 'req-1', 'data-1');

      expect(result).toBe(true);
      expect(validateMock).toHaveBeenCalledWith({
        xSignature: 'ts=1,v1=abc',
        xRequestId: 'req-1',
        dataId: 'data-1',
        secret: 'fake-secret',
      });
    });

    it('devuelve false cuando la validación del SDK lanza error', async () => {
      validateMock.mockImplementation(() => {
        throw new Error('firma inválida');
      });

      const module = await buildModule();
      service = module.get<PaymentService>(PaymentService);

      const result = service.verifyWebhookSignature('ts=1,v1=bad', 'req-1', 'data-1');

      expect(result).toBe(false);
    });
  });

  describe('notifyPaymentApproved', () => {
    it('envía un mensaje de confirmación por Telegram cuando las fechas son objetos Date', async () => {
      const module = await buildModule();
      service = module.get<PaymentService>(PaymentService);

      await service.notifyPaymentApproved('123456789', new Date(2026, 9, 10), new Date(2026, 9, 15));

      expect(botMock.telegram.sendMessage).toHaveBeenCalledWith('123456789', expect.stringContaining('Recibimos tu pago'));
    });

    it('envía un mensaje de confirmación por Telegram cuando las fechas vienen como string (hidratación de MikroORM para columnas "date")', async () => {
      const module = await buildModule();
      service = module.get<PaymentService>(PaymentService);

      await service.notifyPaymentApproved('123456789', '2026-10-10', '2026-10-15');

      expect(botMock.telegram.sendMessage).toHaveBeenCalledWith('123456789', expect.stringContaining('Recibimos tu pago'));
    });
  });
});
