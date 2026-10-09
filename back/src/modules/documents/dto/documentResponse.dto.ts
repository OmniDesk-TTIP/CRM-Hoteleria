import {
  KnowledgeDocument,
  KnowledgeDocumentStatus,
  KnowledgeDocumentType,
} from '../../../infrastructure/database/entities/KnowledgeDocument.entity';

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
