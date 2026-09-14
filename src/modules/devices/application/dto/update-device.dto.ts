import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateDeviceDto {
  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({ format: 'uuid' })
  deviceTypeId?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MinLength(1)
  @MaxLength(100)
  @ApiPropertyOptional({ maxLength: 100 })
  name?: string;

  @IsOptional()
  @IsIn(['WIFI', 'BLUETOOTH'])
  @ApiPropertyOptional({ enum: ['WIFI', 'BLUETOOTH'] })
  transportType?: 'WIFI' | 'BLUETOOTH';

  @IsOptional()
  @IsIn(['MQTT'])
  @ApiPropertyOptional({ enum: ['MQTT'] })
  messagingProtocol?: 'MQTT';
}
