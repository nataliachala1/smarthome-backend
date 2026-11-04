import { ApiProperty } from '@nestjs/swagger';
import { IsIP, IsNotEmpty, IsString } from 'class-validator';

export class IdentifyShellyDeviceDto {
  @ApiProperty({
    example: '10.3.234.222',
    description: 'Dirección IPv4 local del dispositivo Shelly',
  })
  @IsString()
  @IsNotEmpty()
  @IsIP(4)
  shellyIp!: string;
}