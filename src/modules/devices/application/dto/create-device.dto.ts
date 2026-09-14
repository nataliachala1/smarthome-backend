import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateDeviceDto {
  @IsUUID()
  @ApiProperty({ format: 'uuid' })
  deviceTypeId!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ApiProperty({ maxLength: 100 })
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @ApiPropertyOptional({ maxLength: 100 })
  manufacturerDeviceId?: string;

  @IsOptional()
  @IsIn(['WIFI', 'BLUETOOTH'])
  @ApiPropertyOptional({ enum: ['WIFI', 'BLUETOOTH'] })
  transportType?: 'WIFI' | 'BLUETOOTH';

  @IsOptional()
  @IsIn(['MQTT'])
  @ApiPropertyOptional({ enum: ['MQTT'] })
  messagingProtocol?: 'MQTT';
}
