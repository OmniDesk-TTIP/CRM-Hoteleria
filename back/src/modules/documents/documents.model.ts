import { extname } from 'path';
import {
  KnowledgeDocument,
  KnowledgeDocumentStatus,
  KnowledgeDocumentType,
} from '../../infrastructure/database/entities/KnowledgeDocument.entity';

const EXTENSION_TYPES: Record<string, KnowledgeDocumentType> = {
  '.pdf': KnowledgeDocumentType.PDF,
  '.txt': KnowledgeDocumentType.TXT,
};

export const CANONICAL_MIME_TYPES: Record<KnowledgeDocumentType, string> = {
  [KnowledgeDocumentType.PDF]: 'application/pdf',
  [KnowledgeDocumentType.TXT]: 'text/plain',
};

export const MAX_UPLOAD_BYTES =
  Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024;

/** Menos que esto no se considera texto: un PDF escaneado suele devolver espacios o ruido. */
export const MIN_READABLE_TEXT_LENGTH = 10;

/** Tipo de documento según la extensión del nombre (se ignora el mimetype que manda el cliente). */
export function detectDocumentType(
  filename: string,
): KnowledgeDocumentType | undefined {
  return EXTENSION_TYPES[extname(filename).toLowerCase()];
}

/**
 * Multer decodifica el nombre del archivo como latin1, así que "Políticas.pdf" llega como
 * "Polí­ticas.pdf". Si el nombre ya viene bien (UTF-8 real) se devuelve tal cual.
 */
export const decodeFilename = (name: string): string => {
  // Un carácter fuera de latin1 (emoji, "—", "€") significa que el nombre ya es UTF-8 real.
  if ([...name].some((c) => c.charCodeAt(0) > 0xff)) return name;

  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  // Si no era UTF-8 mal decodificado, los bytes no forman UTF-8 válido y aparece U+FFFD.
  return decoded.includes('�') ? name : decoded;
};

/** Lo que ve el panel de un documento: no expone la ruta interna ni quién lo subió. */
export class DocumentResponseDto {
  id!: string;
  filename!: string;
  mimeType!: string;
  type!: KnowledgeDocumentType;
  sizeBytes!: number;
  status!: KnowledgeDocumentStatus;
  chunksCount!: number;
  errorMessage?: string;
  createdAt!: string;

  static fromEntity(doc: KnowledgeDocument): DocumentResponseDto {
    const dto = new DocumentResponseDto();
    dto.id = doc.id;
    dto.filename = doc.filename;
    dto.mimeType = doc.mimeType;
    dto.type = doc.type;
    dto.sizeBytes = doc.sizeBytes;
    dto.status = doc.status;
    dto.chunksCount = doc.chunksCount;
    dto.errorMessage = doc.errorMessage ?? undefined;
    dto.createdAt = doc.createdAt.toISOString();
    return dto;
  }
}
