import {
  IsNotEmpty,
  IsString,
} from 'class-validator';

export class ReactivateAccountDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}