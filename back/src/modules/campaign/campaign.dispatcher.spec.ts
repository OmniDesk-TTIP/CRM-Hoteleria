import {
  CampaignDispatcher,
  DeliveryResult,
  DispatcherOptions,
} from './campaign.dispatcher';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

const photoMessage = (fileId: string) => ({
  photo: [{ file_id: `${fileId}-thumb` }, { file_id: fileId }],
});

describe('CampaignDispatcher', () => {
  let telegram: { sendMessage: jest.Mock; sendPhoto: jest.Mock };
  let sleep: jest.Mock;
  let batches: DeliveryResult[][];
  const onBatch = (results: DeliveryResult[]) => {
    batches.push(results);
    return Promise.resolve();
  };

  const recipients = (count: number) =>
    Array.from({ length: count }, (_, i) => `tg-${i + 1}`);

  const dispatcher = (options: DispatcherOptions = {}) =>
    new CampaignDispatcher(telegram, {
      batchSize: 3,
      batchIntervalMs: 1000,
      sleep,
      now: () => 0,
      ...options,
    });

  beforeEach(() => {
    telegram = {
      sendMessage: jest.fn().mockResolvedValue({}),
      sendPhoto: jest.fn().mockResolvedValue(photoMessage('file-1')),
    };
    sleep = jest.fn().mockResolvedValue(undefined);
    batches = [];
  });

  it('manda por lotes y espera entre uno y otro, pero no después del último', async () => {
    await dispatcher().run(recipients(7), { text: '<b>Hola</b>' }, onBatch);

    expect(batches.map((batch) => batch.length)).toEqual([3, 3, 1]);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(7);
    expect(telegram.sendMessage).toHaveBeenCalledWith('tg-1', '<b>Hola</b>', {
      parse_mode: 'HTML',
    });
  });

  it('solo espera lo que le falta al lote para completar el intervalo', async () => {
    let clock = 0;
    telegram.sendMessage.mockImplementation(() => {
      clock += 100;
      return Promise.resolve({});
    });

    await dispatcher({ now: () => clock }).run(
      recipients(4),
      { text: 'x' },
      onBatch,
    );

    expect(sleep).toHaveBeenCalledWith(700);
  });

  it('un bloqueo (403) u otro error cuentan como fallidos sin reintentar y el envío sigue', async () => {
    telegram.sendMessage.mockImplementation((chatId: string) => {
      if (chatId === 'tg-2')
        return Promise.reject(
          Object.assign(new Error('Forbidden: bot was blocked by the user'), {
            code: 403,
          }),
        );
      if (chatId === 'tg-3')
        return Promise.reject(
          Object.assign(new Error('Bad Request: chat not found'), {
            code: 400,
          }),
        );
      return Promise.resolve({});
    });

    await dispatcher().run(recipients(3), { text: 'x' }, onBatch);

    expect(batches.flat()).toEqual([
      { telegramUserId: 'tg-1', outcome: 'SENT' },
      { telegramUserId: 'tg-2', outcome: 'BLOCKED' },
      { telegramUserId: 'tg-3', outcome: 'FAILED' },
    ]);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(3);
  });

  it('ante un 429 espera lo que pide Telegram y reintenta', async () => {
    telegram.sendMessage
      .mockRejectedValueOnce({
        code: 429,
        response: { parameters: { retry_after: 3 } },
      })
      .mockResolvedValue({});

    await dispatcher().run(['tg-1'], { text: 'x' }, onBatch);

    expect(sleep).toHaveBeenCalledWith(3000);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(2);
    expect(batches.flat()).toEqual([
      { telegramUserId: 'tg-1', outcome: 'SENT' },
    ]);
  });

  it('si el 429 se repite, deja de insistir y lo cuenta como fallido', async () => {
    telegram.sendMessage.mockRejectedValue({ code: 429 });

    await dispatcher().run(['tg-1'], { text: 'x' }, onBatch);

    // Sin retry_after, espera un segundo entre intentos.
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(3);
    expect(batches.flat()).toEqual([
      { telegramUserId: 'tg-1', outcome: 'FAILED' },
    ]);
  });

  it('sube la imagen una sola vez y después reutiliza el file_id', async () => {
    await dispatcher().run(
      recipients(4),
      { text: 'Promo', image: { buffer: JPEG, type: 'jpeg' } },
      onBatch,
    );

    expect(telegram.sendPhoto).toHaveBeenCalledTimes(4);
    expect(telegram.sendPhoto).toHaveBeenNthCalledWith(
      1,
      'tg-1',
      { source: JPEG, filename: 'campania.jpg' },
      { caption: 'Promo', parse_mode: 'HTML' },
    );
    for (const call of telegram.sendPhoto.mock.calls.slice(1))
      expect(call[1]).toBe('file-1');
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    // El primero va solo (hasta tener el file_id) y el resto en un lote.
    expect(batches.map((batch) => batch.length)).toEqual([1, 3]);
  });

  it('si el primero falla, vuelve a subir la imagen con el siguiente', async () => {
    telegram.sendPhoto
      .mockRejectedValueOnce({ code: 403 })
      .mockResolvedValue(photoMessage('file-2'));

    await dispatcher().run(
      recipients(3),
      { text: 'Promo', image: { buffer: JPEG, type: 'jpeg' } },
      onBatch,
    );

    expect(telegram.sendPhoto.mock.calls[1][1]).toEqual({
      source: JPEG,
      filename: 'campania.jpg',
    });
    expect(telegram.sendPhoto.mock.calls[2][1]).toBe('file-2');
    expect(batches.flat().map((result) => result.outcome)).toEqual([
      'BLOCKED',
      'SENT',
      'SENT',
    ]);
  });
});
