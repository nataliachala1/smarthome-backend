import { Injectable } from '@nestjs/common';

import { DeviceTypeRepository } from '../../domain/repositories/device-type.repository';

@Injectable()
export class ListDeviceTypesUseCase {
  constructor(private readonly deviceTypeRepository: DeviceTypeRepository) {}

  async execute() {
    const types = await this.deviceTypeRepository.findAll();

    return types.map((type) => ({
      id: type.id,
      name: type.name,
      description: type.description,
      icon: type.icon,
    }));
  }
}
