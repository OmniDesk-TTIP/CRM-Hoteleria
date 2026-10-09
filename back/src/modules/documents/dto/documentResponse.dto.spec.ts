import { DocumentResponseDto } from './documentResponse.dto';
import {
  KnowledgeDocument,
  KnowledgeDocumentStatus,
  KnowledgeDocumentType,
} from '../../../infrastructure/database/entities/KnowledgeDocument.entity';

const buildDoc = (
  overrides: Partial<KnowledgeDocument> = {},
): KnowledgeDocument =>
  Object.assign(new KnowledgeDocument(), {
    filename: 'politicas.pdf',
    mimeType: 'application/pdf',
    type: KnowledgeDocumentType.PDF,
    sizeBytes: 2048,
    storagePath: 'secreto/ruta/interna.pdf',
    uploadedById: 'user-1',
    createdAt: new Date('2026-10-05T15:30:00.000Z'),
    ...overrides,
  });

describe('DocumentResponseDto', () => {
  it('mapea los campos que necesita el panel (nombre, tipo, tamaño, estado, fecha)', () => {
    const doc = buildDoc({
      status: KnowledgeDocumentStatus.READY,
      chunksCount: 7,
    });

    const dto = DocumentResponseDto.fromEntity(doc);

    expect(dto).toEqual({
      id: doc.id,
      filename: 'politicas.pdf',
      mimeType: 'application/pdf',
      type: 'PDF',
      sizeBytes: 2048,
      status: 'READY',
      chunksCount: 7,
      errorMessage: undefined,
      createdAt: '2026-10-05T15:30:00.000Z',
    });
  });

  it('incluye el mensaje de error cuando el documento falló', () => {
    const dto = DocumentResponseDto.fromEntity(
      buildDoc({
        status: KnowledgeDocumentStatus.ERROR,
        errorMessage: 'El documento no contiene texto legible',
      }),
    );

    expect(dto.status).toBe('ERROR');
    expect(dto.errorMessage).toBe('El documento no contiene texto legible');
  });

  it('serializa createdAt como ISO 8601', () => {
    const dto = DocumentResponseDto.fromEntity(buildDoc());

    expect(new Date(dto.createdAt).toISOString()).toBe(dto.createdAt);
  });

  it('no filtra la ruta de almacenamiento ni el usuario que subió el archivo', () => {
    const dto = DocumentResponseDto.fromEntity(buildDoc());

    expect(dto).not.toHaveProperty('storagePath');
    expect(dto).not.toHaveProperty('uploadedById');
  });

  it('puede usarse directo en Array.map sin perder el contexto', () => {
    const result = [buildDoc(), buildDoc()].map(DocumentResponseDto.fromEntity);

    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(DocumentResponseDto);
  });
});
