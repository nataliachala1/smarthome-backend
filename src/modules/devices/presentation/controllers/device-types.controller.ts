import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';
import { ListDeviceTypesUseCase } from '../../application/use-cases/list-device-types.use-case';

@Controller('api/v1/device-types')
@ApiTags('device-types')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class DeviceTypesController {
  constructor(
    private readonly listDeviceTypesUseCase: ListDeviceTypesUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar tipos de dispositivos disponibles' })
  @ApiOkResponse({ description: 'Catálogo de tipos de dispositivos activos' })
  async findAll() {
    return this.listDeviceTypesUseCase.execute();
  }
}
