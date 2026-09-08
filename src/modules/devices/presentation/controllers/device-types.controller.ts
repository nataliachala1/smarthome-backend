import { Controller, Get, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';
import { ListDeviceTypesUseCase } from '../../application/use-cases/list-device-types.use-case';

@Controller('api/v1/device-types')
@UseGuards(JwtAuthGuard)
export class DeviceTypesController {
  constructor(
    private readonly listDeviceTypesUseCase: ListDeviceTypesUseCase,
  ) {}

  @Get()
  async findAll() {
    return this.listDeviceTypesUseCase.execute();
  }
}
