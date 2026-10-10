import { IsBoolean, IsDefined } from 'class-validator';

export class UpdateSurveyPublicationDto {
  @IsDefined({ message: 'Falta indicar si se publica la reseña' })
  @IsBoolean({ message: 'published debe ser true o false' })
  published!: boolean;
}
