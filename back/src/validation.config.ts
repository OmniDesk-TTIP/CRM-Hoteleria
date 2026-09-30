import { ValidationPipe, BadRequestException } from '@nestjs/common';

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    stopAtFirstError: true,
    transform: true,
    exceptionFactory: (errors) => {
      const constraints = errors[0].constraints || {};

      const firstError = Object.values(constraints)[0] || 'Error de validación';

      return new BadRequestException({
        message: firstError,
        error: 'Bad Request',
        statusCode: 400,
      });
    },
  });
}
