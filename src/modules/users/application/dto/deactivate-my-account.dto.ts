import { ApiProperty } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
} from 'class-validator';

export class DeactivateMyAccountDto {
  @ApiProperty({
    example: true,
    description:
      'Confirmación explícita de la desactivación temporal de la cuenta',
  })
  @IsBoolean()
  @Equals(true, {
    message:
      'Debes confirmar la desactivación de la cuenta',
  })
  confirm!: boolean;
}