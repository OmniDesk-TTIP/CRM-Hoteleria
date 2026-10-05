import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { join, extname } from 'path';
import { DocumentsRepository } from './documents.repository';
import { DocumentResponseDto } from './dto/documentResponse.dto';
import { RagService } from '../rag/rag.service';
import {
  KnowledgeDocument,
  KnowledgeDocumentStatus,
  KnowledgeDocumentType,
} from '../../infrastructure/database/entities/KnowledgeDocument.entity';
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
} from './documents.constants';

interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly uploadDir: string;

  constructor(
    private readonly repo: DocumentsRepository,
    private readonly ragService: RagService,
    private readonly config: ConfigService,
  ) {
    this.uploadDir = this.config.get<string>('UPLOAD_DIR') ?? 'uploads/documents';
  }

  async list(): Promise<DocumentResponseDto[]> {
    const docs = await this.repo.findAll();
    return docs.map(DocumentResponseDto.fromEntity);
  }

  async upload(file: UploadedFile, userId: string): Promise<DocumentResponseDto> {
    this.validateFile(file);

    const type = ALLOWED_MIME_TYPES[file.mimetype as keyof typeof ALLOWED_MIME_TYPES];
    const safeName = this.sanitizeName(file.originalname);
    const doc = this.repo.create({
      filename: file.originalname,
      mimeType: file.mimetype,
      type,
      sizeBytes: file.size,
      storagePath: '', // se completa después de saber el id
      uploadedById: userId,
    });

    await this.repo.saveNew(doc);

    const storedName = `${doc.id}${extname(safeName) || `.${type.toLowerCase()}`}`;
    const absolutePath = join(this.uploadDir, storedName);

    await fs.mkdir(this.uploadDir, { recursive: true });
    await fs.writeFile(absolutePath, file.buffer);

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
      await fs.unlink(absolutePath).catch((err) => {
        this.logger.warn(`No se pudo borrar ${absolutePath}: ${err.message}`);
      });
    }
  }

  private validateFile(file: UploadedFile): void {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');

    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `El archivo supera el tamaño máximo permitido (${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`,
      );
    }

    const ext = extname(file.originalname).toLowerCase();
    const mimeOk = file.mimetype in ALLOWED_MIME_TYPES;
    const extOk = ALLOWED_EXTENSIONS.includes(ext);

    if (!mimeOk && !extOk) {
      throw new BadRequestException(
        'Formato no soportado. Solo se aceptan PDF y TXT.',
      );
    }

    if (!mimeOk && extOk) {
      file.mimetype = ext === '.pdf' ? 'application/pdf' : 'text/plain';
    }
  }

  private sanitizeName(name: string): string {
    return name.replace(/[^\w.\-]+/g, '_').slice(0, 120);
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
      await this.repo.markError(id, message);
    }
  }

  private async extractText(
    buffer: Buffer,
    type: KnowledgeDocumentType,
  ): Promise<string> {
    if (type === KnowledgeDocumentType.TXT) {
      return buffer.toString('utf-8');
    }
    // require() para evitar que el tipado de pdf-parse ensucie el bundle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
    const pdfParse = require('pdf-parse');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const result = await pdfParse(buffer);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
    return result.text as string;
  }
}