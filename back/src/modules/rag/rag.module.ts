import { Module } from '@nestjs/common';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { RagSeederService } from './rag.seeder.service';
import { RagRepository } from './rag.repository';

@Module({
  controllers: [RagController],
  providers: [RagService, RagRepository, RagSeederService],
  exports: [RagService],
})
export class RagModule {}
