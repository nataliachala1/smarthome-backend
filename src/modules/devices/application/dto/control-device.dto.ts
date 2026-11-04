import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export type DeviceControlCommand = 'TURN_ON' | 'TURN_OFF';

export class ControlDeviceDto {
  @IsIn(['TURN_ON', 'TURN_OFF'])
  @ApiProperty({
    enum: ['TURN_ON', 'TURN_OFF'],
    description: 'Comando remoto que se enviará al dispositivo',
    example: 'TURN_ON',
  })
  command!: DeviceControlCommand;
}