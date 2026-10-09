import { ArgumentsHost, PayloadTooLargeException } from '@nestjs/common';
import { FileTooLargeFilter } from './file-too-large.filter';

describe('FileTooLargeFilter', () => {
  it('responde 413 con un mensaje en español en lugar del "File too large" de multer', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;

    new FileTooLargeFilter().catch(
      new PayloadTooLargeException('File too large'),
      host,
    );

    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith({
      statusCode: 413,
      error: 'Payload Too Large',
      message: expect.stringContaining(
        'El archivo supera el tamaño máximo permitido',
      ),
    });
  });
});
