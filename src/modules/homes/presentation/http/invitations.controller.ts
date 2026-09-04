import {
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../../auth/presentation/http/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../auth/domain/types/authenticated-user.type';

import { ListMyInvitationsUseCase } from '../../application/use-cases/list-my-invitations.use-case';
import { AcceptInvitationUseCase } from '../../application/use-cases/accept-invitation.use-case';
import { RejectInvitationUseCase } from '../../application/use-cases/reject-invitation.use-case';

@Controller('api/v1/invitations')
@UseGuards(JwtAuthGuard)
export class InvitationsController {
  constructor(
    private readonly listMyInvitationsUseCase:
      ListMyInvitationsUseCase,

    private readonly acceptInvitationUseCase:
      AcceptInvitationUseCase,

    private readonly rejectInvitationUseCase:
      RejectInvitationUseCase,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.listMyInvitationsUseCase.execute(
      user.userId,
    );
  }

  @Patch(':memberId/accept')
  async accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('memberId') memberId: string,
  ) {
    return this.acceptInvitationUseCase.execute(
      user.userId,
      memberId,
    );
  }

  @Patch(':memberId/reject')
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('memberId') memberId: string,
  ) {
    return this.rejectInvitationUseCase.execute(
      user.userId,
      memberId,
    );
  }
}