import { KnowledgeDocumentType } from '../../infrastructure/database/entities/KnowledgeDocument.entity';

export const EXTENSION_TYPES: Record<string, KnowledgeDocumentType> = {
  '.pdf': KnowledgeDocumentType.PDF,
  '.txt': KnowledgeDocumentType.TXT,
};

export const CANONICAL_MIME_TYPES: Record<KnowledgeDocumentType, string> = {
  [KnowledgeDocumentType.PDF]: 'application/pdf',
  [KnowledgeDocumentType.TXT]: 'text/plain',
};

export const MAX_UPLOAD_BYTES =
  Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024;
