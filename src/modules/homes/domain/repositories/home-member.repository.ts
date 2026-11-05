import { HomeMember } from '../entities/home-member.entity';

export interface CreateInvitationData {
  userId: string;
  homeId: string;
  invitedUserId: string;
  role: 'MEMBER' | 'GUEST';
}

export abstract class HomeMemberRepository {
    abstract findAllByHome(
        userId: string,
        homeId: string,
    ): Promise<HomeMember[]>;

    abstract createInvitation(
        data: CreateInvitationData,
    ): Promise<HomeMember>;

    abstract findPendingByUser(
    userId: string,
    ): Promise<HomeMember[]>;

    abstract findByIdForUser(
    userId: string,
    memberId: string,
    ): Promise<HomeMember | null>;

    abstract acceptInvitation(
    userId: string,
    memberId: string,
    ): Promise<HomeMember>;

    abstract rejectInvitation(
    userId: string,
    memberId: string,
    ): Promise<HomeMember>;

    abstract leaveHome(
    userId: string,
    homeId: string,
    ): Promise<HomeMember>;

    abstract updateRole(
    userId: string,
    homeId: string,
    memberId: string,
    role: 'MEMBER' | 'GUEST',
    ): Promise<HomeMember>;

    abstract revoke(
    userId: string,
    homeId: string,
    memberId: string,
    ): Promise<HomeMember>;
}