import {
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateHomeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

}
