import { ApiProperty } from '@nestjs/swagger';

export class DiscoveredShellyDeviceDto {
  @ApiProperty({
    example: '10.3.234.97',
  })
  ip!: string;

  @ApiProperty({
    example: 'Shelly1PMG4-D885ACF06990.local.',
  })
  hostname!: string;

  @ApiProperty({
    example: 80,
  })
  port!: number;

  @ApiProperty({
    example: 'shelly1pmg4-d885acf06990',
  })
  manufacturerDeviceId!: string;

  @ApiProperty({
    example: 'D885ACF06990',
  })
  mac!: string;

  @ApiProperty({
    example: 'Shelly 1PM Gen4',
  })
  model!: string;

  @ApiProperty({
    example: 'S4SW-001P16EU',
  })
  modelCode!: string;

  @ApiProperty({
    example: 4,
  })
  generation!: number;

  @ApiProperty({
    example: '1.7.0',
    nullable: true,
  })
  firmwareVersion!: string | null;
}