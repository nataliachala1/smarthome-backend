import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  ListHomesOutput,
  ListHomesUseCase,
} from '../../application/use-cases/list-homes.use-case';

import {
  CreateHomeOutput,
  CreateHomeUseCase,
} from '../../application/use-cases/create-home.use-case';

import { CreateHomeDto } from '../../application/dto/create-home.dto';

import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';

import { CurrentUser } from '../../../auth/presentation/http/decorators/current-user.decorator';

import type { AuthenticatedUser } from '../../../auth/domain/types/authenticated-user.type';

import {
  NotFoundException,
  Param,
  Patch,
} from '@nestjs/common';

import {
  GetHomeByIdOutput,
  GetHomeByIdUseCase,
} from '../../application/use-cases/get-home-by-id.use-case';

import { UpdateHomeOutput, UpdateHomeUseCase, } from '../../application/use-cases/update-home.use-case';

import { UpdateHomeDto } from '../../application/dto/update-home.dto';
import { DeactivateHomeUseCase } from '../../application/use-cases/deactivate-home.use-case';
import { ReactivateHomeUseCase } from '../../application/use-cases/reactivate-home.use-case';
import { CreateZoneDto } from '../../application/dto/create-zone.dto';
import { CreateZoneUseCase } from '../../application/use-cases/create-zone.use-case';
import { ListZonesUseCase } from '../../application/use-cases/list-zones.use-case';

import {
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DeactivateZoneUseCase } from '../../application/use-cases/deactivate-zone.use-case';
import { UpdateZoneUseCase } from '../../application/use-cases/update-zone.use-case';
import { GetZoneByIdUseCase } from '../../application/use-cases/get-zone-by-id.use-case';
import { UpdateZoneDto } from '../../application/dto/update-zone.dto';
import { CreateHomeInvitationDto } from '../../application/dto/create-home-invitation.dto';
import { CreateHomeInvitationUseCase } from '../../application/use-cases/create-home-invitation.use-case';
import { ListHomeMembersUseCase } from '../../application/use-cases/list-home-members.use-case';
import { LeaveHomeUseCase } from '../../application/use-cases/leave-home.use-case';
import { UpdateHomeMemberRoleDto } from '../../application/dto/update-home-member-role.dto';
import { UpdateHomeMemberRoleUseCase } from '../../application/use-cases/update-home-member-role.use-case';
import { RevokeHomeMemberUseCase } from '../../application/use-cases/revoke-home-member.use-case';

@Controller('api/v1/homes')
export class HomesController {
  constructor(
    private readonly listHomesUseCase: ListHomesUseCase,
    private readonly createHomeUseCase: CreateHomeUseCase,
    private readonly getHomeByIdUseCase: GetHomeByIdUseCase,
    private readonly updateHomeUseCase: UpdateHomeUseCase,
    private readonly deactivateHomeUseCase: DeactivateHomeUseCase,
    private readonly reactivateHomeUseCase: ReactivateHomeUseCase,
    private readonly listZonesUseCase: ListZonesUseCase,
    private readonly createZoneUseCase: CreateZoneUseCase,
    private readonly getZoneByIdUseCase: GetZoneByIdUseCase,
    private readonly updateZoneUseCase: UpdateZoneUseCase,
    private readonly deactivateZoneUseCase: DeactivateZoneUseCase,
    private readonly listHomeMembersUseCase: ListHomeMembersUseCase,
    private readonly createHomeInvitationUseCase: CreateHomeInvitationUseCase,
    private readonly leaveHomeUseCase: LeaveHomeUseCase,
    private readonly updateHomeMemberRoleUseCase: UpdateHomeMemberRoleUseCase,
    private readonly revokeHomeMemberUseCase: RevokeHomeMemberUseCase,

  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ListHomesOutput[]> {
    return this.listHomesUseCase.execute({
      userId: user.userId,
    });
  }

    @Get(':homeId')
  @UseGuards(JwtAuthGuard)
  async findById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId') homeId: string,
  ): Promise<GetHomeByIdOutput> {
    const home = await this.getHomeByIdUseCase.execute({
      userId: user.userId,
      homeId,
    });

    if (!home) {
      throw new NotFoundException(
        'Hogar no encontrado',
      );
    }

    return home;
  }
  
@Get(':homeId/members')
@UseGuards(JwtAuthGuard)
async listMembers(
  @CurrentUser() user: AuthenticatedUser,
  @Param('homeId') homeId: string,
) {
  return this.listHomeMembersUseCase.execute({
    userId: user.userId,
    homeId,
  });
}

@Post(':homeId/invitations')
@UseGuards(JwtAuthGuard)
async createInvitation(
  @CurrentUser() user: AuthenticatedUser,
  @Param('homeId') homeId: string,
  @Body() dto: CreateHomeInvitationDto,
) {
  return this.createHomeInvitationUseCase.execute({
    userId: user.userId,
    homeId,
    email: dto.email,
    role: dto.role,
  });
}

@Patch(':homeId/members/:memberId/role')
@UseGuards(JwtAuthGuard)
async updateMemberRole(
  @CurrentUser() user: AuthenticatedUser,
  @Param('homeId') homeId: string,
  @Param('memberId') memberId: string,
  @Body() dto: UpdateHomeMemberRoleDto,
) {
  return this.updateHomeMemberRoleUseCase.execute({
    userId: user.userId,
    homeId,
    memberId,
    role: dto.role,
  });
}

@Patch(':homeId/members/:memberId/revoke')
@UseGuards(JwtAuthGuard)
async revokeMember(
  @CurrentUser() user: AuthenticatedUser,
  @Param('homeId') homeId: string,
  @Param('memberId') memberId: string,
) {
  return this.revokeHomeMemberUseCase.execute(
    user.userId,
    homeId,
    memberId,
  );
}

  @Get(':homeId/zones')
@UseGuards(JwtAuthGuard)
async listZones(
  @CurrentUser() user: AuthenticatedUser,
  @Param('homeId') homeId: string,
) {
  return this.listZonesUseCase.execute({
    userId: user.userId,
    homeId,
  });
}

@Patch(':homeId/members/me/leave')
@UseGuards(JwtAuthGuard)
async leaveHome(
  @CurrentUser() user: AuthenticatedUser,
  @Param('homeId') homeId: string,
) {
  return this.leaveHomeUseCase.execute(
    user.userId,
    homeId,
  );
}

@Post(':homeId/zones')
@UseGuards(JwtAuthGuard)
async createZone(
  @CurrentUser() user: AuthenticatedUser,
  @Param('homeId') homeId: string,
  @Body() dto: CreateZoneDto,
) {
  return this.createZoneUseCase.execute({
    userId: user.userId,
    homeId,
    name: dto.name,
    type: dto.type,
  });
}

@Get(':homeId/zones/:zoneId')
@UseGuards(JwtAuthGuard)
async getZoneById(
  @CurrentUser() user: AuthenticatedUser,
  @Param('homeId') homeId: string,
  @Param('zoneId') zoneId: string,
) {
  return this.getZoneByIdUseCase.execute({
    userId: user.userId,
    homeId,
    zoneId,
  });
}

@Patch(':homeId/zones/:zoneId')
@UseGuards(JwtAuthGuard)
async updateZone(
  @CurrentUser() user: AuthenticatedUser,
  @Param('homeId') homeId: string,
  @Param('zoneId') zoneId: string,
  @Body() dto: UpdateZoneDto,
) {
  return this.updateZoneUseCase.execute({
    userId: user.userId,
    homeId,
    zoneId,
    name: dto.name,
    type: dto.type,
  });
}

@Patch(':homeId/zones/:zoneId/deactivate')
@HttpCode(HttpStatus.NO_CONTENT)
@UseGuards(JwtAuthGuard)
async deactivateZone(
  @CurrentUser() user: AuthenticatedUser,
  @Param('homeId') homeId: string,
  @Param('zoneId') zoneId: string,
): Promise<void> {
  await this.deactivateZoneUseCase.execute({
    userId: user.userId,
    homeId,
    zoneId,
  });
}

  @Patch(':homeId')
  @UseGuards(JwtAuthGuard)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId') homeId: string,
    @Body() dto: UpdateHomeDto,
  ): Promise<UpdateHomeOutput> {
    return this.updateHomeUseCase.execute({
      userId: user.userId,
      homeId,
      name: dto.name,
      stratum: dto.stratum,
    });
  }

  @Patch(':homeId/deactivate')
@UseGuards(JwtAuthGuard)
async deactivate(
  @CurrentUser() user: AuthenticatedUser,
  @Param('homeId') homeId: string,
) {
  return this.deactivateHomeUseCase.execute({
    userId: user.userId,
    homeId,
  });
}

@Patch(':homeId/reactivate')
@UseGuards(JwtAuthGuard)
async reactivate(
  @CurrentUser() user: AuthenticatedUser,
  @Param('homeId') homeId: string,
) {
  return this.reactivateHomeUseCase.execute({
    userId: user.userId,
    homeId,
  });
}

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateHomeDto,
  ): Promise<CreateHomeOutput> {
    return this.createHomeUseCase.execute({
      userId: user.userId,
      name: dto.name,
      stratum: dto.stratum,
    });
  }
}