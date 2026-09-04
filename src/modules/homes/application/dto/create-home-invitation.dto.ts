import {
  IsEmail,
  IsIn,
} from 'class-validator';

export class CreateHomeInvitationDto {
  @IsEmail()
  email!: string;

  @IsIn(['MEMBER', 'GUEST'])
  role!: 'MEMBER' | 'GUEST';
}