import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export type DeviceControlCommand = 'TURN_ON' | 'TURN_OFF';

export class ControlDeviceDto {
  @IsIn(['TURN_ON', 'TURN_OFF'])
  @ApiProperty({
    enum: ['TURN_ON', 'TURN_OFF'],
    description: 'Remote command to send to the device',
    example: 'TURN_ON',
  })
  command!: DeviceControlCommand;
}