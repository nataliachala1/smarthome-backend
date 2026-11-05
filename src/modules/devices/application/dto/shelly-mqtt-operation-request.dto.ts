import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/** Shared Android request body for prepare/bootstrap/enable/confirm operations. */
export class ShellyMqttOperationRequestDto {
  @ApiProperty({
    description: 'ID devuelto por POST .../mqtt/prepare para esta sesión.',
    format: 'uuid',
  })
  @IsUUID('4')
  operationId!: string;

  @ApiPropertyOptional({
    description: 'Solo para el flujo de laboratorio local; VPS DEV no lo usa como prueba MQTT.',
  })
  @IsOptional()
  @IsBoolean()
  localConfigurationReadbackVerified?: boolean;
}
