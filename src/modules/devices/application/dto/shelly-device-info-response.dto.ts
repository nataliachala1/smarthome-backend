import { ApiProperty } from '@nestjs/swagger';

export class ShellyDeviceInfoResponseDto {
  @ApiProperty({
    example: 'shelly1pmg4-d885acf06990',
  })
  manufacturerDeviceId!: string;

  @ApiProperty({
    example: 'Shelly 1PM Gen4',
  })
  model!: string;

  @ApiProperty({
    example: 'S4SW-001P16EU',
  })
  modelCode!: string;

  @ApiProperty({
    example: 'D885ACF06990',
  })
  mac!: string;

  @ApiProperty({
    example: '10.3.234.222',
  })
  wifiIp!: string;

  @ApiProperty({
    example: '1.7.0',
    nullable: true,
  })
  firmwareVersion!: string | null;

  @ApiProperty({
    example: false,
    nullable: true,
    description:
      'null cuando el estado MQTT no puede consultarse por autenticación u otra restricción',
  })
  mqttConnected!: boolean | null;

  @ApiProperty({
    example: false,
  })
  authenticationRequired!: boolean;

  @ApiProperty({
    example: 'Shelly detectado correctamente',
  })
  message!: string;
}