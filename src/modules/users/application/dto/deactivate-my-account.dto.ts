import { ApiProperty } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
} from 'class-validator';

export class DeactivateMyAccountDto {
  @ApiProperty({
    example: true,
    description:
      'Explicit confirmation of the temporary account deactivation',
  })
  @IsBoolean()
  @Equals(true, {
    message:
      'Debes confirmar la desactivación de la cuenta',
  })
  confirm!: boolean;
}