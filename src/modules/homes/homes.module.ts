import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { HomesController } from './presentation/http/homes.controller';

import { ListHomesUseCase } from './application/use-cases/list-homes.use-case';
import { CreateHomeUseCase } from './application/use-cases/create-home.use-case';

import { HomeRepository } from './domain/repositories/home.repository';

import { PrismaHomeRepository } from './infrastructure/persistence/prisma-home.repository';

import { GetHomeByIdUseCase } from './application/use-cases/get-home-by-id.use-case';
import { UpdateHomeUseCase } from './application/use-cases/update-home.use-case';

import { DeactivateHomeUseCase } from './application/use-cases/deactivate-home.use-case';
import { ReactivateHomeUseCase } from './application/use-cases/reactivate-home.use-case';

import { CreateZoneUseCase } from './application/use-cases/create-zone.use-case';
import { ListZonesUseCase } from './application/use-cases/list-zones.use-case';
import { ZoneRepository } from './domain/repositories/zone.repository';
import { PrismaZoneRepository } from './infrastructure/persistence/prisma-zone.repository';
import { DeactivateZoneUseCase } from './application/use-cases/deactivate-zone.use-case';
import { UpdateZoneUseCase } from './application/use-cases/update-zone.use-case';
import { GetZoneByIdUseCase } from './application/use-cases/get-zone-by-id.use-case';
import { HomeMemberRepository } from './domain/repositories/home-member.repository';
import { PrismaHomeMemberRepository } from './infrastructure/persistence/prisma-home-member.repository';
import { ListHomeMembersUseCase } from './application/use-cases/list-home-members.use-case';
import { CreateHomeInvitationUseCase } from './application/use-cases/create-home-invitation.use-case';
import { UsersModule } from '../users/users.module';
import { InvitationsController } from './presentation/http/invitations.controller';

import { ListMyInvitationsUseCase } from './application/use-cases/list-my-invitations.use-case';
import { AcceptInvitationUseCase } from './application/use-cases/accept-invitation.use-case';
import { RejectInvitationUseCase } from './application/use-cases/reject-invitation.use-case';
import { LeaveHomeUseCase } from './application/use-cases/leave-home.use-case';
import { RevokeHomeMemberUseCase } from './application/use-cases/revoke-home-member.use-case';
import { UpdateHomeMemberRoleUseCase } from './application/use-cases/update-home-member-role.use-case';

@Module({
  imports: [
    AuthModule,
    UsersModule,
  ],

  controllers: [
    HomesController,
    InvitationsController,
  ],

  providers: [
    ListHomesUseCase,
    CreateHomeUseCase,
    ListHomesUseCase,
    CreateHomeUseCase,
    GetHomeByIdUseCase,
    UpdateHomeUseCase,
    DeactivateHomeUseCase,
    ReactivateHomeUseCase,
    ListZonesUseCase,
    CreateZoneUseCase,
    GetZoneByIdUseCase,
    UpdateZoneUseCase,
    DeactivateZoneUseCase,
    ListHomeMembersUseCase,
    CreateHomeInvitationUseCase,
    ListMyInvitationsUseCase,
    AcceptInvitationUseCase,
    RejectInvitationUseCase,
    LeaveHomeUseCase,
    UpdateHomeMemberRoleUseCase,
    RevokeHomeMemberUseCase,

{
  provide: HomeMemberRepository,
  useClass: PrismaHomeMemberRepository,
},

    {
      provide: ZoneRepository,
      useClass: PrismaZoneRepository,
    },

    {
      provide: HomeRepository,
      useClass: PrismaHomeRepository,
    },
  ],
})
export class HomesModule {}