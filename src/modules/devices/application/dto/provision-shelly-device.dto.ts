import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsIP,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ProvisionShellyDeviceDto {
  @ApiProperty({
    example: '10.3.234.97',
    description: 'Dirección IPv4 local del Shelly',
  })
  @IsString()
  @IsNotEmpty()
  @IsIP(4)
  shellyIp!: string;

  @ApiProperty({
    example: 'Lámpara sala',
    maxLength: 100,
  })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Tipo de dispositivo SmartHome',
  })
  @IsUUID()
  deviceTypeId!: string;
}