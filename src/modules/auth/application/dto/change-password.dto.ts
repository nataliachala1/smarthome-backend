import {
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @Matches(/[A-Z]/, {
    message: 'La nueva contraseña debe contener al menos una letra mayúscula',
  })
  @Matches(/[0-9]/, {
    message: 'La nueva contraseña debe contener al menos un número',
  })
  @Matches(/[^A-Za-z0-9]/, {
    message: 'La nueva contraseña debe contener al menos un carácter especial',
  })
  newPassword: string;

  @IsString()
  @IsNotEmpty()
  newPasswordConfirmation: string;
}