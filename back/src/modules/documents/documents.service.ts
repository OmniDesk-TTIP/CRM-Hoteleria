import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { join, extname } from 'path';
import { DocumentsRepository } from './documents.repository';
import { DocumentResponseDto } from './dto/documentResponse.dto';
import { RagService } from '../rag/rag.service';
import { KnowledgeDocumentType } from '../../infrastructure/database/entities/KnowledgeDocument.entity';
import {
  CANONICAL_MIME_TYPES,
  EXTENSION_TYPES,
  MAX_UPLOAD_BYTES,
} from './documents.constants';

const INTERRUPTED_MESSAGE =
  'El procesamiento se interrumpió. Eliminá el documento y volvé a subirlo.';

interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class DocumentsService implements OnModuleInit {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly uploadDir: string;

  constructor(
    private readonly repo: DocumentsRepository,
    private readonly ragService: RagService,
    private readonly config: ConfigService,
  ) {
    this.uploadDir =
      this.config.get<string>('UPLOAD_DIR') ?? 'uploads/documents';
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.repo.runInContext(async () => {
        const interrupted = await this.repo.findInProgress();
        for (const doc of interrupted) {
          await this.discardPartialChunks(doc.id);
          await this.repo.markError(doc.id, INTERRUPTED_MESSAGE);
        }
        if (interrupted.length > 0) {
          this.logger.warn(
            `${interrupted.length} documento(s) con procesamiento interrumpido marcados como ERROR`,
          );
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      this.logger.warn(
        `No se pudo revisar documentos interrumpidos: ${message}`,
      );
    }
  }

  async list(): Promise<DocumentResponseDto[]> {
    const docs = await this.repo.findAll();
    return docs.map((doc) => DocumentResponseDto.fromEntity(doc));
  }

  async upload(
    file: UploadedFile,
    userId: string,
  ): Promise<DocumentResponseDto> {
    const type = this.validateFile(file);

    const doc = this.repo.create({
      filename: file.originalname,
      mimeType: CANONICAL_MIME_TYPES[type],
      type,
      sizeBytes: file.size,
      storagePath: '', // se completa después de saber el id
      uploadedById: userId,
    });

    await this.repo.saveNew(doc);

    const storedName = `${doc.id}.${type.toLowerCase()}`;
    const absolutePath = join(this.uploadDir, storedName);

    try {
      await fs.mkdir(this.uploadDir, { recursive: true });
      await fs.writeFile(absolutePath, file.buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      this.logger.error(`No se pudo guardar ${doc.id} en disco: ${message}`);
      await this.repo.deleteById(doc.id);
      throw new InternalServerErrorException(
        'No se pudo guardar el archivo. Intentá de nuevo.',
      );
    }

    doc.storagePath = storedName;
    await this.repo.save();

    void this.processInBackground(doc.id, file.buffer, type);

    return DocumentResponseDto.fromEntity(doc);
  }

  async remove(id: string): Promise<void> {
    const doc = await this.repo.findById(id);
    if (!doc) throw new NotFoundException('Documento no encontrado');

    await this.repo.deleteById(id);

    if (doc.storagePath) {
      const absolutePath = join(this.uploadDir, doc.storagePath);
      await fs.unlink(absolutePath).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`No se pudo borrar ${absolutePath}: ${message}`);
      });
    }
  }

  private validateFile(file: UploadedFile): KnowledgeDocumentType {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');

    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `El archivo supera el tamaño máximo permitido (${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`,
      );
    }

    const type = EXTENSION_TYPES[extname(file.originalname).toLowerCase()];

    if (!type) {
      throw new BadRequestException(
        'Formato no soportado. Solo se aceptan PDF y TXT.',
      );
    }

    return type;
  }

  private async processInBackground(
    id: string,
    buffer: Buffer,
    type: KnowledgeDocumentType,
  ): Promise<void> {
    try {
      await this.repo.markProcessing(id);

      const text = await this.extractText(buffer, type);

      if (!text || text.trim().length < 10) {
        await this.repo.markError(id, 'El documento no contiene texto legible');
        return;
      }

      const chunksCount = await this.ragService.ingestDocument(text, id);

      await this.repo.markReady(id, chunksCount);
      this.logger.log(`Documento ${id} indexado (${chunksCount} chunks)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      this.logger.error(`Falló la vectorización de ${id}: ${message}`);
      await this.discardPartialChunks(id);
      await this.repo.markError(id, message);
    }
  }

  private async discardPartialChunks(id: string): Promise<void> {
    try {
      await this.ragService.removeDocumentChunks(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      this.logger.warn(
        `No se pudieron limpiar los chunks parciales de ${id}: ${message}`,
      );
    }
  }

  private async extractText(
    buffer: Buffer,
    type: KnowledgeDocumentType,
  ): Promise<string> {
    if (type === KnowledgeDocumentType.TXT) {
      return buffer.toString('utf-8');
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as typeof import('pdf-parse');
    const result = await pdfParse(buffer);
    return result.text;
  }
}
