import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchAvailabilityDto } from './searchAvailability.dto';

describe('SearchAvailabilityDto', () => {
  const validPayload = { checkIn: '10-10-2026', checkOut: '15-10-2026', capacity: 2 };

  it('no arroja errores con datos válidos', async () => {
    const dto = plainToInstance(SearchAvailabilityDto, validPayload);

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rechaza checkIn con formato inválido', async () => {
    const dto = plainToInstance(SearchAvailabilityDto, { ...validPayload, checkIn: '2026-10-10' });

    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'checkIn')).toBe(true);
  });

  it('rechaza checkOut con una fecha calendario inválida', async () => {
    const dto = plainToInstance(SearchAvailabilityDto, { ...validPayload, checkOut: '31-02-2026' });

    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'checkOut')).toBe(true);
  });

  it('rechaza capacidad no entera', async () => {
    const dto = plainToInstance(SearchAvailabilityDto, { ...validPayload, capacity: 2.5 });

    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'capacity')).toBe(true);
  });

  it('rechaza capacidad menor a 1', async () => {
    const dto = plainToInstance(SearchAvailabilityDto, { ...validPayload, capacity: 0 });

    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'capacity')).toBe(true);
  });

  it('transforma la capacidad recibida como string a número', async () => {
    const dto = plainToInstance(SearchAvailabilityDto, { ...validPayload, capacity: '3' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.capacity).toBe(3);
  });
});
