import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import * as fs from 'fs';
import * as path from 'path';
import { RagService } from './rag.service';
import { RagRepository } from './rag.repository';
import {
  KnowledgeDocument,
  KnowledgeDocumentStatus,
  KnowledgeDocumentType,
} from '../../infrastructure/database/entities/KnowledgeDocument.entity';

export const BASE_KNOWLEDGE_FILENAME = 'Conocimiento Base';

@Injectable()
export class RagSeederService implements OnModuleInit {
  private readonly logger = new Logger(RagSeederService.name);

  constructor(
    private readonly ragService: RagService,
    private readonly ragRepository: RagRepository,
    private readonly em: EntityManager,
  ) {}

  async onModuleInit() {
    const count = await this.ragRepository.countDocuments();

    if (count === 0) {
      this.logger.log(
        'Base de datos vacía. Iniciando inyección de conocimiento por defecto...',
      );
      await this.seedDefaultKnowledge();
      this.logger.log('Conocimiento base inyectado exitosamente. RAG listo.');
    } else {
      this.logger.log(
        `El RAG ya cuenta con ${count} fragmentos de conocimiento en memoria.`,
      );
    }
  }

  private async seedDefaultKnowledge() {
    try {
      const filePath = path.join(process.cwd(), 'knowledge.json');
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const defaultKnowledge: string[] = JSON.parse(fileContent) as string[];

      let baseDoc = await this.em.findOne(KnowledgeDocument, {
        filename: BASE_KNOWLEDGE_FILENAME,
      });

      if (!baseDoc) {
        baseDoc = this.em.create(KnowledgeDocument, {
          filename: BASE_KNOWLEDGE_FILENAME,
          status: KnowledgeDocumentStatus.READY,
          mimeType: 'application/json',
          type: KnowledgeDocumentType.TXT,
          sizeBytes: Buffer.byteLength(fileContent),
          storagePath: 'internal/seeder/knowledge.json',
        });
        this.em.persist(baseDoc);
        await this.em.flush();
      }

      let chunksCount = 0;
      for (const text of defaultKnowledge) {
        chunksCount +=
          (await this.ragService.ingestDocument(text, baseDoc.id)) ?? 0;
      }

      baseDoc.chunksCount = chunksCount;
      await this.em.flush();
    } catch (error) {
      this.logger.error(
        'Error al intentar leer o procesar knowledge.json',
        error,
      );
    }
  }
}
