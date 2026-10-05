import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
} from '@mikro-orm/decorators/legacy';
import { CustomBaseEntity } from './CustomBase.entity';
import type { KnowledgeDocument } from './KnowledgeDocument.entity';

@Entity({ tableName: 'document' })
export class Document extends CustomBaseEntity {
  @PrimaryKey({ type: 'integer', autoincrement: true })
  id!: number;

  @Property({ type: 'text' })
  content!: string;

  @Property({ type: 'vector', columnType: 'vector(3072)' })
  embedding!: number[];

  @ManyToOne(() => require('./KnowledgeDocument.entity').KnowledgeDocument, {
    nullable: true,
    fieldName: 'source_document_id',
    deleteRule: 'cascade',
  })
  sourceDocument?: KnowledgeDocument;

  @Property({ type: 'varchar', length: 255, nullable: true })
  filename?: string;

  @Property({ type: 'varchar', length: 120, nullable: true, fieldName: 'mime_type' })
  mimeType?: string;
}
