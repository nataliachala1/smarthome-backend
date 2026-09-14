import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListNotificationsQueryDto {
  @IsOptional()
  @IsIn(['UNREAD', 'READ', 'DISMISSED'])
  @ApiPropertyOptional({
    enum: ['UNREAD', 'READ', 'DISMISSED'],
    description: 'Estado de la notificación',
    example: 'UNREAD',
  })
  status?: 'UNREAD' | 'READ' | 'DISMISSED';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiPropertyOptional({
    description: 'Cantidad máxima de notificaciones a retornar',
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  limit?: number;
}