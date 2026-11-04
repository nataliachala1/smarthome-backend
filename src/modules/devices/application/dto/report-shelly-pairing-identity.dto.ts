import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

export class ReportShellyPairingIdentityDto {
  @ApiProperty({ example: 'shelly1pmg4-d885acf06990', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  manufacturerDeviceId!: string;

  @ApiProperty({ example: 4, minimum: 1 })
  @IsInt()
  @Min(1)
  generation!: number;

  @ApiProperty({ example: 'S4SW-001P16EU', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  modelCode!: string;

  @ApiProperty({
    example: '20260819-101735/2.0.1-beta1-g8a88c73',
    required: false,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  firmwareVersion?: string;
}
