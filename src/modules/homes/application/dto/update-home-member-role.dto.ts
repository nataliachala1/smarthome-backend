import { IsIn } from 'class-validator';

export class UpdateHomeMemberRoleDto {
  @IsIn(['MEMBER', 'GUEST'])
  role!: 'MEMBER' | 'GUEST';
}