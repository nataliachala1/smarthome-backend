import { HomeMember } from '../../domain/entities/home-member.entity';

interface PrismaHomeMemberRecord {
  id_home_member: string;
  id_home: string;
  id_user: string;
  role: string;
  status: string;
  invited_by: string | null;
  invited_at: Date;
  accepted_at: Date | null;
  ended_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export class PrismaHomeMemberMapper {
  static toDomain(
    raw: PrismaHomeMemberRecord,
  ): HomeMember {
    return new HomeMember({
      id: raw.id_home_member,
      homeId: raw.id_home,
      userId: raw.id_user,
      role: raw.role,
      status: raw.status,
      invitedBy: raw.invited_by,
      invitedAt: raw.invited_at,
      acceptedAt: raw.accepted_at,
      endedAt: raw.ended_at,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    });
  }
}