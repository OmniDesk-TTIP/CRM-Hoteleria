import { Controller, Post, Body, HttpCode, HttpStatus, BadRequestException, UseGuards } from '@nestjs/common';
import { RagService } from './rag.service';
import { IngestDataDto, AskQuestionDto } from './dto/rag.dto';
import { Public, Roles } from '../auth/auth.decorators';
import { RolesGuard } from '../auth/auth.guard';
import { UserRole } from '../../infrastructure/database/entities/User.entity';

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  // Cargar contenido acá es escribir en la base de conocimiento del bot: solo un ADMIN.
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Post('ingest')
  @HttpCode(HttpStatus.OK)
  async ingestData(@Body() ingestDataDto: IngestDataDto) {
    await this.ragService.ingestDocument(ingestDataDto.text);
        
    return { 
      message: 'Documento particionado, vectorizado y guardado con éxito.',
      status: 'success'
    };
  }

  // El bot de Telegram consulta en nombre de huéspedes sin cuenta.
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