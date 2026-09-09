import {
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateHomeDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

}
