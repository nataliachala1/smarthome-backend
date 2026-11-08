import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/** Shared Android request body for prepare/bootstrap/enable/confirm operations. */
export class ShellyMqttOperationRequestDto {
  @ApiProperty({
    description: 'ID returned by POST .../mqtt/prepare for this session.',
    format: 'uuid',
  })
  @IsUUID('4')
  operationId!: string;

  @ApiPropertyOptional({
    description: 'Only for the local lab flow; VPS DEV does not use it as an MQTT proof.',
  })
  @IsOptional()
  @IsBoolean()
  localConfigurationReadbackVerified?: boolean;
}
