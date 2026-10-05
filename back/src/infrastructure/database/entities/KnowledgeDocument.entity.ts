import { Opt } from '@mikro-orm/core';
import {
  Entity,
  PrimaryKey,
  Property,
  Enum,
} from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { CustomBaseEntity } from './CustomBase.entity';

export enum KnowledgeDocumentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  ERROR = 'ERROR',
}

export enum KnowledgeDocumentType {
  PDF = 'PDF',
  TXT = 'TXT',
}

@Entity({ tableName: 'knowledge_documents' })
export class KnowledgeDocument extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @Property({ type: 'varchar', length: 255 })
  filename!: string;

  @Property({ type: 'varchar', length: 120 })
  mimeType!: string;

  @Enum(() => KnowledgeDocumentType)
  type!: KnowledgeDocumentType;

  @Property({ type: 'integer' })
  sizeBytes!: number;

  @Property({ type: 'varchar', length: 500 })
  storagePath!: string;

  @Enum(() => KnowledgeDocumentStatus)
  status: KnowledgeDocumentStatus & Opt = KnowledgeDocumentStatus.PENDING;

  @Property({ type: 'integer' })
  chunksCount: number & Opt = 0;

  @Property({ type: 'text', nullable: true })
  errorMessage?: string;

  @Property({ type: 'uuid', nullable: true })
  uploadedById?: string;

}