import { IsBoolean, IsOptional } from 'class-validator';

export class SetDevicePermissionsDto {
  @IsOptional()
  @IsBoolean()
  canViewDevice?: boolean | null;

  @IsOptional()
  @IsBoolean()
  canViewConsumption?: boolean | null;

  @IsOptional()
  @IsBoolean()
  canControlDevice?: boolean | null;
}
