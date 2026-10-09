import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  EXCEPTION_FILTERS_METADATA,
  GUARDS_METADATA,
} from '@nestjs/common/constants';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { FileTooLargeFilter } from './file-too-large.filter';
import { RolesGuard } from '../auth/auth.guard';
import { ROLES_KEY } from '../auth/auth.decorators';
import { UserRole } from '../../infrastructure/database/entities/User.entity';
import { AuthUser } from '../auth/auth.types';

describe('DocumentsController', () => {
  let controller: DocumentsController;
  let service: { list: jest.Mock; upload: jest.Mock; remove: jest.Mock };

  const admin = {
    id: 'admin-1',
    email: 'admin@hotel.test',
    role: UserRole.ADMIN,
  } as AuthUser;

  beforeEach(async () => {
    service = {
      list: jest.fn(),
      upload: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [{ provide: DocumentsService, useValue: service }],
    })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(DocumentsController);
  });

  describe('seguridad (CA6)', () => {
    it('restringe todo el controller al rol ADMIN', () => {
      expect(Reflect.getMetadata(ROLES_KEY, DocumentsController)).toEqual([
        UserRole.ADMIN,
      ]);
    });

    it('aplica RolesGuard a nivel de clase, así ninguna ruta queda sin proteger', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        DocumentsController,
      ) as unknown[];

      expect(guards).toContain(RolesGuard);
    });
  });

  describe('list', () => {
    it('devuelve lo que entrega el service', async () => {
      const docs = [{ id: 'doc-1', filename: 'reglas.txt' }];
      service.list.mockResolvedValue(docs);

      await expect(controller.list()).resolves.toBe(docs);
    });
  });

  describe('upload', () => {
    const file = {
      originalname: 'reglas.txt',
      mimetype: 'text/plain',
      size: 12,
      buffer: Buffer.from('hola'),
      fieldname: 'file',
      encoding: '7bit',
    } as Express.Multer.File;

    it('rechaza con 400 si no se adjuntó ningún archivo', async () => {
      await expect(controller.upload(undefined, admin)).rejects.toThrow(
        new BadRequestException('Adjuntá un archivo PDF o TXT'),
      );
      expect(service.upload).not.toHaveBeenCalled();
    });

    it('le pasa al service solo los datos del archivo y el id del usuario autenticado', async () => {
      service.upload.mockResolvedValue({ id: 'doc-1' });

      const result = await controller.upload(file, admin);

      expect(service.upload).toHaveBeenCalledWith(
        {
          originalname: 'reglas.txt',
          mimetype: 'text/plain',
          size: 12,
          buffer: file.buffer,
        },
        'admin-1',
      );
      expect(result).toEqual({ id: 'doc-1' });
    });
  });

  describe('upload - nombre y tamaño', () => {
    const baseFile = {
      originalname: 'reglas.txt',
      mimetype: 'text/plain',
      size: 12,
      buffer: Buffer.from('hola'),
    } as Express.Multer.File;

    it('corrige el nombre cuando multer lo decodificó como latin1 (tildes y ñ)', async () => {
      service.upload.mockResolvedValue({ id: 'doc-1' });
      const garbled = Buffer.from(
        'Políticas de cancelación.pdf',
        'utf8',
      ).toString('latin1');

      await controller.upload({ ...baseFile, originalname: garbled }, admin);

      expect(service.upload).toHaveBeenCalledWith(
        expect.objectContaining({
          originalname: 'Políticas de cancelación.pdf',
        }),
        'admin-1',
      );
    });

    it('traduce el 413 de multer con FileTooLargeFilter en la ruta de carga', () => {
      const filters = Reflect.getMetadata(
        EXCEPTION_FILTERS_METADATA,
        DocumentsController.prototype.upload,
      ) as unknown[];

      expect(filters).toContain(FileTooLargeFilter);
    });
  });

  describe('remove', () => {
    it('delega en el service y no devuelve cuerpo', async () => {
      service.remove.mockResolvedValue(undefined);

      await expect(controller.remove('doc-1')).resolves.toBeUndefined();
      expect(service.remove).toHaveBeenCalledWith('doc-1');
    });

    it('propaga el 404 del service cuando el documento no existe', async () => {
      service.remove.mockRejectedValue(new Error('Documento no encontrado'));

      await expect(controller.remove('doc-1')).rejects.toThrow(
        'Documento no encontrado',
      );
    });
  });
});
