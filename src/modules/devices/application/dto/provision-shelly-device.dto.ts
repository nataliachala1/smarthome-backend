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
      'Dirección IPv4 local del dispositivo Shelly',
  })
  @IsString()
  @IsNotEmpty()
  @IsIP(4)
  shellyIp!: string;

  @ApiProperty({
    example: 'Lámpara sala',
    description:
      'Nombre que el usuario desea asignar al dispositivo',
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