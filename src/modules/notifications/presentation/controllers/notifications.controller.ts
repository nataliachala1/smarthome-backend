import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../../auth/presentation/http/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../../auth/domain/types/authenticated-user.type';

import { ListNotificationsQueryDto } from '../../application/dto/list-notifications-query.dto';
import { ListNotificationsUseCase } from '../../application/use-cases/list-notifications.use-case';

import { Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiParam,
} from '@nestjs/swagger';

import { UpdateNotificationStatusUseCase } from '../../application/use-cases/update-notification-status.use-case';
import { GetUnreadNotificationsCountUseCase } from '../../application/use-cases/get-unread-notifications-count.use-case';
import { MarkAllNotificationsAsReadUseCase } from '../../application/use-cases/mark-all-notifications-as-read.use-case';

@Controller('api/v1/notifications')
@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly listNotificationsUseCase: ListNotificationsUseCase,
    private readonly updateNotificationStatusUseCase: UpdateNotificationStatusUseCase,
    private readonly getUnreadNotificationsCountUseCase: GetUnreadNotificationsCountUseCase,
    private readonly markAllNotificationsAsReadUseCase: MarkAllNotificationsAsReadUseCase,
  ) {}

  @Get('unread-count')
@ApiOperation({
  summary: 'Consultar cantidad de notificaciones no leídas',
})
@ApiOkResponse({
  description: 'Cantidad de notificaciones no leídas del usuario autenticado',
})
async unreadCount(@CurrentUser() user: AuthenticatedUser) {
  return this.getUnreadNotificationsCountUseCase.execute({
    userId: user.userId,
  });
}

  @Get()
  @ApiOperation({
    summary: 'Listar notificaciones del usuario autenticado',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['UNREAD', 'READ', 'DISMISSED'],
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Cantidad máxima de registros, entre 1 y 100',
  })
  @ApiOkResponse({
    description: 'Notificaciones del usuario autenticado',
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.listNotificationsUseCase.execute({
      userId: user.userId,
      status: query.status,
      limit: query.limit,
    });
  }
   @Patch('read-all')
@ApiOperation({
  summary: 'Marcar todas las notificaciones no leídas como leídas',
})
@ApiOkResponse({
  description: 'Cantidad de notificaciones actualizadas',
})
async markAllAsRead(@CurrentUser() user: AuthenticatedUser) {
  return this.markAllNotificationsAsReadUseCase.execute({
    userId: user.userId,
  });
}

  @Patch(':notificationId/read')
@ApiOperation({
  summary: 'Marcar una notificación como leída',
})
@ApiParam({
  name: 'notificationId',
  description: 'UUID de la notificación',
  format: 'uuid',
})
@ApiOkResponse({
  description: 'Notificación marcada como leída',
})
@ApiNotFoundResponse({
  description: 'Notificación no encontrada',
})
async markAsRead(
  @CurrentUser() user: AuthenticatedUser,
  @Param('notificationId', ParseUUIDPipe) notificationId: string,
) {
  return this.updateNotificationStatusUseCase.execute({
    userId: user.userId,
    notificationId,
    status: 'READ',
  });
}


@Patch(':notificationId/dismiss')
@ApiOperation({
  summary: 'Descartar una notificación',
})
@ApiParam({
  name: 'notificationId',
  description: 'UUID de la notificación',
  format: 'uuid',
})
@ApiOkResponse({
  description: 'Notificación descartada',
})
@ApiNotFoundResponse({
  description: 'Notificación no encontrada',
})
async dismiss(
  @CurrentUser() user: AuthenticatedUser,
  @Param('notificationId', ParseUUIDPipe) notificationId: string,
) {
  return this.updateNotificationStatusUseCase.execute({
    userId: user.userId,
    notificationId,
    status: 'DISMISSED',
  });
}

}