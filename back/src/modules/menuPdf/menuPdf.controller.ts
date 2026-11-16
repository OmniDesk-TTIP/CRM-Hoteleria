import {
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { RolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/auth.decorators';
import { UserRole } from '../../infrastructure/database/entities/User.entity';
import { MenuPdfKind } from './menuPdf.model';
import { MenuPdfService } from './menuPdf.service';

@Roles(UserRole.ADMIN)
@UseGuards(RolesGuard)
@Controller('menu-pdfs')
export class MenuPdfController {
  constructor(private readonly menuPdfService: MenuPdfService) {}

  @Get(':kind')
  async getPdf(
    @Param('kind', new ParseEnumPipe(MenuPdfKind)) kind: MenuPdfKind,
  ): Promise<StreamableFile> {
    const { source, filename } = await this.menuPdfService.buildForAdmin(kind);
    return new StreamableFile(source, {
      type: 'application/pdf',
      disposition: `inline; filename="${filename}"`,
      length: source.length,
    });
  }
}
