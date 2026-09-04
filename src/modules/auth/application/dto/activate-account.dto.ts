import {
  IsNotEmpty,
  IsString,
} from 'class-validator';

export class ActivateAccountDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}