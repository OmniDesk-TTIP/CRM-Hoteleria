import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AskQuestionDto, IngestDataDto } from './rag.dto';

describe('IngestDataDto', () => {
  it('no arroja errores con un texto válido', async () => {
    const dto = plainToInstance(IngestDataDto, { text: 'Este es un texto suficientemente largo.' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rechaza un texto vacío', async () => {
    const dto = plainToInstance(IngestDataDto, { text: '' });

    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'text')).toBe(true);
  });

  it('rechaza un texto más corto que el mínimo permitido', async () => {
    const dto = plainToInstance(IngestDataDto, { text: 'corto' });

    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'text')).toBe(true);
  });

  it('rechaza un texto que excede el máximo permitido', async () => {
    const dto = plainToInstance(IngestDataDto, { text: 'a'.repeat(2001) });

    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'text')).toBe(true);
  });
});

describe('AskQuestionDto', () => {
  it('no arroja errores con una pregunta válida', async () => {
    const dto = plainToInstance(AskQuestionDto, { question: '¿Cuáles son los horarios del hotel?' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('recorta espacios al inicio y al final de la pregunta', async () => {
    const dto = plainToInstance(AskQuestionDto, { question: '  ¿Hay wifi?  ' });

    expect(dto.question).toBe('¿Hay wifi?');
  });

  it('rechaza una pregunta vacía luego de recortar espacios', async () => {
    const dto = plainToInstance(AskQuestionDto, { question: '   ' });

    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'question')).toBe(true);
  });

  it('rechaza una pregunta más corta que el mínimo permitido', async () => {
    const dto = plainToInstance(AskQuestionDto, { question: 'hola' });

    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'question')).toBe(true);
  });

  it('rechaza una pregunta que excede el máximo permitido', async () => {
    const dto = plainToInstance(AskQuestionDto, { question: 'a'.repeat(301) });

    const errors = await validate(dto);

    expect(errors.some(e => e.property === 'question')).toBe(true);
  });
});
