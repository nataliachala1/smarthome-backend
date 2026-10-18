import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, Length, Matches } from 'class-validator';

export class CreateShellyPairingSessionDto {
  @ApiProperty({
    description: 'UUID estable para reintentar esta misma creación.',
  })
  @IsUUID()
  requestId!: string;

  @ApiProperty({
    description:
      'Token aleatorio generado y conservado por el móvil; el servidor solo almacena su hash.',
    minLength: 43,
    maxLength: 128,
  })
  @IsString()
  @Length(43, 128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  sessionToken!: string;

  @ApiProperty({ enum: ['AP', 'BLE'], example: 'AP' })
  @IsIn(['AP', 'BLE'])
  method!: 'AP' | 'BLE';
}
