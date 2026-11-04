import { IsBoolean } from 'class-validator';

export class SetHomeMemberPermissionsDto {
  @IsBoolean()
  canViewDevices!: boolean;

  @IsBoolean()
  canViewConsumption!: boolean;

  @IsBoolean()
  canControlDevices!: boolean;
}
