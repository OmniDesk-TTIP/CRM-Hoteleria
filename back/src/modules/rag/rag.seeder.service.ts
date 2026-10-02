import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { RagService } from './rag.service';
import { RagRepository } from './rag.repository';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class RagSeederService implements OnModuleInit {
  private readonly logger = new Logger(RagSeederService.name);

  constructor(
    private readonly ragService: RagService,
    private readonly ragRepository: RagRepository,
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
      const defaultKnowledge: string[] = JSON.parse(fileContent);

      for (const text of defaultKnowledge) {
        await this.ragService.ingestDocument(text);
      }
    } catch (error) {
      this.logger.error(
        'Error al intentar leer o procesar knowledge.json',
        error,
      );
    }
  }
}
