import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../../validation.config';
import { MAX_ENTRY_REFERENCE_LENGTH } from '../account.model';
import {
  RegisterChargeDto,
  RegisterPaymentDto,
  RegisterRefundDto,
  ReverseEntryDto,
} from './account.dto';

const pipe = createValidationPipe();
const OPERATION_ID = randomUUID();

const validate = (metatype: new () => object, body: unknown) =>
  pipe.transform(body, { type: 'body', metatype });

const messageOf = async (metatype: new () => object, body: unknown) => {
  try {
    await validate(metatype, body);
    return null;
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    return (error.getResponse() as { message: string }).message;
  }
};

describe('DTOs de pagos (US-28)', () => {
  it('acepta un pago con referencia y la recorta', async () => {
    await expect(
      validate(RegisterPaymentDto, {
        operationId: OPERATION_ID,
        amount: 1500.5,
        paymentMethod: 'CARD',
        reference: '  cupón 12 ',
      }),
    ).resolves.toEqual({
      operationId: OPERATION_ID,
      amount: 1500.5,
      paymentMethod: 'CARD',
      reference: 'cupón 12',
    });
  });

  it('la referencia es opcional', async () => {
    expect(
      await messageOf(RegisterPaymentDto, {
        operationId: OPERATION_ID,
        amount: 100,
        paymentMethod: 'CASH',
      }),
    ).toBeNull();
  });

  it.each([
    [
      { operationId: OPERATION_ID, amount: 10.123, paymentMethod: 'CASH' },
      /dos decimales/,
    ],
    [
      { operationId: OPERATION_ID, amount: 'cien', paymentMethod: 'CASH' },
      /número/,
    ],
    [
      { operationId: OPERATION_ID, amount: 0, paymentMethod: 'CASH' },
      /mayor a cero/,
    ],
    [
      { operationId: OPERATION_ID, amount: -5, paymentMethod: 'CASH' },
      /mayor a cero/,
    ],
    [
      { operationId: OPERATION_ID, amount: 100, paymentMethod: 'CHEQUE' },
      /medio de pago/,
    ],
    [
      {
        operationId: OPERATION_ID,
        amount: 100,
        paymentMethod: 'CASH',
        reference: 'x'.repeat(MAX_ENTRY_REFERENCE_LENGTH + 1),
      },
      /referencia/,
    ],
  ])('rechaza el pago %j', async (body, message) => {
    expect(await messageOf(RegisterPaymentDto, body)).toMatch(message);
  });

  it.each([[{}], [{ reason: '   ' }]])(
    'la anulación exige el motivo: %j',
    async (body) => {
      expect(await messageOf(ReverseEntryDto, body)).toMatch(/motivo/);
    },
  );

  it('el reintegro exige medio y motivo', async () => {
    expect(
      await messageOf(RegisterRefundDto, {
        operationId: OPERATION_ID,
        amount: 100,
        reason: 'Error',
      }),
    ).toMatch(/medio de pago/);
    expect(
      await messageOf(RegisterRefundDto, {
        operationId: OPERATION_ID,
        amount: 100,
        paymentMethod: 'CASH',
        reason: ' ',
      }),
    ).toMatch(/motivo/);
  });

  it.each([[undefined], ['no-es-uuid']])(
    'un pago sin clave de operación válida se rechaza: %s',
    async (operationId) => {
      expect(
        await messageOf(RegisterPaymentDto, {
          operationId,
          amount: 100,
          paymentMethod: 'CASH',
        }),
      ).toMatch(/clave de operación/);
    },
  );
});

describe('DTO de consumos cargados a mano (US-27)', () => {
  it('acepta un consumo del restó y recorta los textos', async () => {
    await expect(
      validate(RegisterChargeDto, {
        operationId: OPERATION_ID,
        origin: 'RESTAURANT',
        amount: 18500.5,
        ticketNumber: ' 1234 ',
        detail: '  Cena para 2 ',
      }),
    ).resolves.toEqual({
      operationId: OPERATION_ID,
      origin: 'RESTAURANT',
      amount: 18500.5,
      ticketNumber: '1234',
      detail: 'Cena para 2',
    });
  });

  it.each([
    [
      { operationId: OPERATION_ID, origin: 'ROOM_SERVICE', amount: 100 },
      /RESTAURANT o RECEPTION/,
    ],
    [
      { operationId: OPERATION_ID, origin: 'SPA', amount: 100 },
      /RESTAURANT o RECEPTION/,
    ],
    [
      { operationId: OPERATION_ID, origin: 'RESTAURANT', amount: 0 },
      /mayor a cero/,
    ],
    [{ operationId: 'no-es-uuid', origin: 'RESTAURANT', amount: 100 }, /UUID/],
    [
      {
        operationId: OPERATION_ID,
        origin: 'RESTAURANT',
        amount: 100,
        ticketNumber: 'x'.repeat(31),
      },
      /número de ticket/,
    ],
    [
      {
        operationId: OPERATION_ID,
        origin: 'RECEPTION',
        amount: 100,
        detail: 'x'.repeat(141),
      },
      /detalle/,
    ],
  ])('rechaza %j', async (body, message) => {
    expect(String(await messageOf(RegisterChargeDto, body))).toMatch(message);
  });
});
