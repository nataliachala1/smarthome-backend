import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

import {
  DeviceAccessDeniedError,
  DeviceConflictError,
  InvalidDeviceReferenceError,
} from '../../domain/errors/device-persistence.error';

import {
  DeviceCannotBeControlledError,
  DeviceControlNotConfiguredError,
  DeviceControlPublisherUnavailableError,
  DeviceOfflineForControlError,
} from '../../domain/errors/device-control.error';

export function throwDeviceHttpError(error: unknown): never {
  if (error instanceof DeviceAccessDeniedError) {
    throw new ForbiddenException(error.message);
  }

  if (error instanceof DeviceConflictError) {
    throw new ConflictException(error.message);
  }

  if (error instanceof InvalidDeviceReferenceError) {
    throw new BadRequestException(error.message);
  }

  if (
    error instanceof DeviceCannotBeControlledError ||
    error instanceof DeviceOfflineForControlError ||
    error instanceof DeviceControlNotConfiguredError ||
    error instanceof DeviceControlPublisherUnavailableError
  ) {
    throw new ConflictException(error.message);
  }

  throw error;
}