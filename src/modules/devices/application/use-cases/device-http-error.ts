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
export function throwDeviceHttpError(error: unknown): never {
  if (error instanceof DeviceAccessDeniedError)
    throw new ForbiddenException(error.message);
  if (error instanceof DeviceConflictError)
    throw new ConflictException(error.message);
  if (error instanceof InvalidDeviceReferenceError)
    throw new BadRequestException(error.message);
  throw error;
}
