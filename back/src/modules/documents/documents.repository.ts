import { Injectable } from '@nestjs/common';
import {
  EntityManager as CoreEntityManager,
  RequestContext,
} from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  KnowledgeDocument,
  KnowledgeDocumentStatus,
  KnowledgeDocumentType,
} from '../../infrastructure/database/entities/KnowledgeDocument.entity';

interface CreateDocumentData {
  filename: string;
  mimeType: string;
  type: KnowledgeDocumentType;
  sizeBytes: number;
  storagePath: string;
  uploadedById?: string;
}

@Injectable()
export class DocumentsRepository {
  constructor(private readonly em: EntityManager) {}

  async findAll(): Promise<KnowledgeDocument[]> {
    return this.em.find(
      KnowledgeDocument,
      {},
      { orderBy: { createdAt: 'desc' } },
    );
  }

  async findById(id: string): Promise<KnowledgeDocument | null> {
    return this.em.findOne(KnowledgeDocument, { id });
  }

  async findInProgress(): Promise<KnowledgeDocument[]> {
    return this.em.find(KnowledgeDocument, {
      status: {
        $in: [
          KnowledgeDocumentStatus.PENDING,
          KnowledgeDocumentStatus.PROCESSING,
        ],
      },
    });
  }

  runInContext<T>(work: () => Promise<T>): Promise<T> {
    return RequestContext.create(this.em as unknown as CoreEntityManager, work);
  }

  create(data: CreateDocumentData): KnowledgeDocument {
    return this.em.create(KnowledgeDocument, {
      ...data,
      status: KnowledgeDocumentStatus.PENDING,
      chunksCount: 0,
    });
  }

  async saveNew(doc: KnowledgeDocument): Promise<void> {
    this.em.persist(doc);
    await this.em.flush();
  }

  async save(): Promise<void> {
    await this.em.flush();
  }

  async markProcessing(id: string): Promise<void> {
    await this.em.nativeUpdate(
      KnowledgeDocument,
      { id },
      { status: KnowledgeDocumentStatus.PROCESSING, errorMessage: null },
    );
  }

  async markReady(id: string, chunksCount: number): Promise<void> {
    await this.em.nativeUpdate(
      KnowledgeDocument,
      { id },
      {
        status: KnowledgeDocumentStatus.READY,
        chunksCount,
        errorMessage: null,
      },
    );
  }

  async markError(id: string, message: string): Promise<void> {
    await this.em.nativeUpdate(
      KnowledgeDocument,
      { id },
      {
        status: KnowledgeDocumentStatus.ERROR,
        errorMessage: message.slice(0, 500),
      },
    );
  }

  async deleteById(id: string): Promise<void> {
    await this.em.nativeDelete(KnowledgeDocument, { id });
  }
}
