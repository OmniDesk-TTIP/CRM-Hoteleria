import { KnowledgeDocumentType } from '../../infrastructure/database/entities/KnowledgeDocument.entity';

export const ALLOWED_MIME_TYPES: Record<string, KnowledgeDocumentType> = {
  'application/pdf': KnowledgeDocumentType.PDF,
  'text/plain': KnowledgeDocumentType.TXT,
};

export const ALLOWED_EXTENSIONS = ['.pdf', '.txt'];

export const MAX_UPLOAD_BYTES =
  Number(process.env.MAX_UPLOAD_MB ?? 20) * 1024 * 1024;