import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { Document } from '../../infrastructure/database/entities/Document.entity';
@Injectable()
export class RagRepository {
  constructor(private readonly em: EntityManager) {}
  async saveDocumentChunk(
    text: string,
    embeddingVector: number[],
  ): Promise<Document> {
    const formattedEmbedding = `[${embeddingVector.join(',')}]`;

    const document = this.em.create(Document, {
      content: text,
      embedding: formattedEmbedding as any,
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
}
