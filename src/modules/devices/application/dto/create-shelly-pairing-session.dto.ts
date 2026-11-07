import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, Length, Matches } from 'class-validator';

export class CreateShellyPairingSessionDto {
  @ApiProperty({
    description: 'Stable UUID to retry this same creation.',
  })
  @IsUUID()
  requestId!: string;

  @ApiProperty({
    description:
      'Random token generated and kept by the mobile app; the server only stores its hash.',
    minLength: 43,
    maxLength: 128,
  })
  @IsString()
  @Length(43, 128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  sessionToken!: string;

  @ApiProperty({
    description:
      'LAN for a Shelly already connected to the local network; AP for a new device. BLE is not enabled.',
    enum: ['LAN', 'AP'],
    example: 'LAN',
  })
  @IsIn(['LAN', 'AP'])
  method!: 'LAN' | 'AP';
}
