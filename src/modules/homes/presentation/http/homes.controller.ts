import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';

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
  GetHomeByIdOutput,
  GetHomeByIdUseCase,
} from '../../application/use-cases/get-home-by-id.use-case';

import {
  UpdateHomeOutput,
  UpdateHomeUseCase,
} from '../../application/use-cases/update-home.use-case';

import { UpdateHomeDto } from '../../application/dto/update-home.dto';

import { CreateHomeInvitationDto } from '../../application/dto/create-home-invitation.dto';
import { CreateHomeInvitationUseCase } from '../../application/use-cases/create-home-invitation.use-case';
import { ListHomeMembersUseCase } from '../../application/use-cases/list-home-members.use-case';
import { LeaveHomeUseCase } from '../../application/use-cases/leave-home.use-case';
import { UpdateHomeMemberRoleDto } from '../../application/dto/update-home-member-role.dto';
import { UpdateHomeMemberRoleUseCase } from '../../application/use-cases/update-home-member-role.use-case';
import { RevokeHomeMemberUseCase } from '../../application/use-cases/revoke-home-member.use-case';
import {
  DeleteHomeOutput,
  DeleteHomeUseCase,
} from '../../application/use-cases/delete-home.use-case';

import { HomeHasDevicesError } from '../../domain/errors/home-has-devices.error';
import { HomeAccessDeniedError } from '../../domain/errors/home-access-denied.error';

@Controller('api/v1/homes')
@ApiBearerAuth('access-token')
export class HomesController {
  constructor(
    private readonly listHomesUseCase: ListHomesUseCase,
    private readonly createHomeUseCase: CreateHomeUseCase,
    private readonly getHomeByIdUseCase: GetHomeByIdUseCase,
    private readonly updateHomeUseCase: UpdateHomeUseCase,
    private readonly listHomeMembersUseCase: ListHomeMembersUseCase,
    private readonly createHomeInvitationUseCase: CreateHomeInvitationUseCase,
    private readonly leaveHomeUseCase: LeaveHomeUseCase,
    private readonly updateHomeMemberRoleUseCase: UpdateHomeMemberRoleUseCase,
    private readonly revokeHomeMemberUseCase: RevokeHomeMemberUseCase,
    private readonly deleteHomeUseCase: DeleteHomeUseCase,
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
      throw new NotFoundException('Hogar no encontrado');
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

  @Delete(':homeId')
  @UseGuards(JwtAuthGuard)
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId') homeId: string,
  ): Promise<DeleteHomeOutput> {
    try {
      return await this.deleteHomeUseCase.execute({
        userId: user.userId,
        homeId,
      });
    } catch (error) {
      if (error instanceof HomeHasDevicesError) {
        throw new ConflictException(error.message);
      }

      if (error instanceof HomeAccessDeniedError) {
        throw new NotFoundException('Hogar no encontrado');
      }

      throw error;
    }
  }

  @Patch(':homeId/members/:memberId/revoke')
  @UseGuards(JwtAuthGuard)
  async revokeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId') homeId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.revokeHomeMemberUseCase.execute(user.userId, homeId, memberId);
  }

  @Patch(':homeId/members/me/leave')
  @UseGuards(JwtAuthGuard)
  async leaveHome(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId') homeId: string,
  ) {
    return this.leaveHomeUseCase.execute(user.userId, homeId);
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
    });
  }
}
