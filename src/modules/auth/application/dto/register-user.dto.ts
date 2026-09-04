import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';

export class RegisterUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  email: string;

  @IsString()
  @MinLength(8)
  @Matches(/[A-Z]/, {
    message: 'La contraseña debe contener al menos una letra mayúscula',
  })
  @Matches(/[0-9]/, {
    message: 'La contraseña debe contener al menos un número',
  })
  @Matches(/[^A-Za-z0-9]/, {
    message: 'La contraseña debe contener al menos un carácter especial',
  })
  password: string;
}