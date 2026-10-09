import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { Document } from '../../infrastructure/database/entities/Document.entity';
import { KnowledgeDocument } from '../../infrastructure/database/entities/KnowledgeDocument.entity';

@Injectable()
export class RagRepository {
  constructor(private readonly em: EntityManager) {}

  async saveDocumentChunk(
    text: string,
    embeddingVector: number[],
    source?: { id: string; filename: string; mimeType: string },
  ): Promise<Document> {
    const formattedEmbedding = `[${embeddingVector.join(',')}]`;

    const document = this.em.create(Document, {
      content: text,
      embedding: formattedEmbedding as unknown as number[],
      sourceDocument: source
        ? this.em.getReference(KnowledgeDocument, source.id)
        : undefined,
      filename: source?.filename,
      mimeType: source?.mimeType,
    });

    this.em.persist(document);
    await this.em.flush();
    return document;
  }

  async findSimilar(
    embeddingVector: number[],
    limit: number = 5,
  ): Promise<Document[]> {
    const connection = this.em.getConnection();
    const vectorString = `[${embeddingVector.join(',')}]`;

    const query = `
      SELECT id, content, created_at, updated_at
      FROM document
      ORDER BY embedding <-> ?::vector
      LIMIT ?
    `;

    const results = await connection.execute(query, [vectorString, limit]);
    return results.map((row) => this.em.map(Document, row));
  }

  async countDocuments(): Promise<number> {
    return await this.em.count(Document);
  }

  async deleteChunksBySourceDocument(sourceDocumentId: string): Promise<void> {
    await this.em.nativeDelete(Document, {
      sourceDocument: { id: sourceDocumentId },
    });
  }

  async findSourceDocument(id: string): Promise<KnowledgeDocument | null> {
    return this.em.findOne(KnowledgeDocument, { id });
  }
}
