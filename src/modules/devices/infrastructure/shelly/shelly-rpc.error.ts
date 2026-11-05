import { BadGatewayException } from '@nestjs/common';

const messages = {
  SHELLY_RPC_TIMEOUT: 'El Shelly no respondió dentro del tiempo permitido.',
  SHELLY_UNREACHABLE: 'No fue posible contactar al Shelly.',
  SHELLY_HTTP_ERROR: 'El Shelly respondió con un error HTTP.',
  SHELLY_AUTH_REQUIRED: 'El Shelly requiere autenticación local.',
  SHELLY_INVALID_RESPONSE: 'El Shelly devolvió una respuesta inválida.',
  SHELLY_RPC_ERROR: 'El Shelly rechazó la operación RPC.',
} as const;

export type ShellyRpcErrorCode = keyof typeof messages;

export class ShellyRpcError extends BadGatewayException {
  constructor(readonly code: ShellyRpcErrorCode) {
    // Never include the upstream body, address, credentials or raw exception.
    super({ code, message: messages[code] });
  }
}
