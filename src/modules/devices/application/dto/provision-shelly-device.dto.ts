import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

import {
  IsIP,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ProvisionShellyDeviceDto {
  @ApiProperty({
    example: '10.3.234.97',
    description:
      'Local IPv4 address of the Shelly device',
  })
  @IsString()
  @IsNotEmpty()
  @IsIP(4)
  shellyIp!: string;

  @ApiProperty({
    example: 'Lámpara sala',
    description:
      'Name the user wants to give the device',
    maxLength: 100,
  })
  @IsString()
  @Transform(
    ({ value }: { value: unknown }) =>
      typeof value === 'string'
        ? value.trim()
        : value,
  )
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}