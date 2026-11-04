import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateMyPreferencesDto {
  @IsOptional()
  @IsIn(['es', 'en', 'fr', 'de'])
  language?: string;

  @IsOptional()
  @IsIn(['claro', 'oscuro', 'automatico'])
  theme?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @IsIn(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'])
  dateFormat?: string;

  @IsOptional()
  @IsIn(['12h', '24h'])
  timeFormat?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)*$/, {
    message: 'timezone debe tener formato IANA, por ejemplo America/Bogota',
  })
  timezone?: string;
}