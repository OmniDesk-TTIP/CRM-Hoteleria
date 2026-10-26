import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { RagService } from './rag.service';
import { IngestDataDto, AskQuestionDto } from './dto/rag.dto';
import { Public, Roles } from '../auth/auth.decorators';
import { RolesGuard } from '../auth/auth.guard';
import { UserRole } from '../../infrastructure/database/entities/User.entity';

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @HttpCode(HttpStatus.OK)
  async ingestData(@Body() ingestDataDto: IngestDataDto) {
    await this.ragService.ingestDocument(ingestDataDto.text);

    return {
      message: 'Documento particionado, vectorizado y guardado con éxito.',
      status: 'success',
    };
  }

  @Public()
  @Post('ask')
  @HttpCode(HttpStatus.OK)
  async askQuestion(@Body() askQuestionDto: AskQuestionDto) {
    const answer = await this.ragService.askQuestion(askQuestionDto.question);

    return {
      question: askQuestionDto.question,
      answer,
    };
  }
}
