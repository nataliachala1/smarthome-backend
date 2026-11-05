import { IsEmail, IsNotEmpty } from 'class-validator';

export class ResendActivationDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
}