import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

/** SQLSTATE codes from PostgreSQL that callers can act on. */
const SQLSTATE_TO_STATUS: Record<string, number> = {
  '23505': HttpStatus.CONFLICT, // unique_violation
  '23503': HttpStatus.CONFLICT, // foreign_key_violation
  '23514': HttpStatus.BAD_REQUEST, // check_violation
  '23502': HttpStatus.BAD_REQUEST, // not_null_violation
  '22P02': HttpStatus.BAD_REQUEST, // invalid_text_representation
  '22001': HttpStatus.BAD_REQUEST, // string_data_right_truncation
  '42501': HttpStatus.FORBIDDEN, // insufficient_privilege (includes RLS)
};

/** Prisma error codes that do not wrap a PostgreSQL SQLSTATE. */
const PRISMA_TO_STATUS: Record<string, number> = {
  P2000: HttpStatus.BAD_REQUEST, // value too long
  P2002: HttpStatus.CONFLICT, // unique constraint
  P2003: HttpStatus.CONFLICT, // foreign key constraint
  P2025: HttpStatus.NOT_FOUND, // record required but not found
};

/** End-user messages: they are shown in the web and mobile clients. */
const USER_MESSAGES: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'La solicitud contiene datos no válidos.',
  [HttpStatus.FORBIDDEN]: 'No tienes permiso para realizar esta acción.',
  [HttpStatus.NOT_FOUND]: 'El recurso solicitado no existe.',
  [HttpStatus.CONFLICT]: 'La operación entra en conflicto con datos existentes.',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Ocurrió un error interno. Intenta de nuevo más tarde.',
};

const STATUS_NAMES: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
};

/**
 * Central error handler for every HTTP request.
 *
 * - HttpException instances (including those thrown by controllers after
 *   mapping domain errors) keep their status and body.
 * - Database errors are translated to 4xx responses without leaking SQL,
 *   table names or stack traces.
 * - Anything else becomes a generic 500; details go only to the server log.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      throw exception;
    }

    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toResponse(exception);

    if (status >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json(body);
  }

  toResponse(exception: unknown): { status: number; body: unknown } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload: string | object = exception.getResponse();
      return {
        status,
        body:
          typeof payload === 'string'
            ? { statusCode: status, message: payload, error: STATUS_NAMES[status] ?? 'Error' }
            : payload,
      };
    }

    const status = this.databaseStatus(exception) ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const body: ErrorBody = {
      statusCode: status,
      message: USER_MESSAGES[status] ?? USER_MESSAGES[HttpStatus.INTERNAL_SERVER_ERROR]!,
      error: STATUS_NAMES[status] ?? 'Internal Server Error',
    };
    return { status, body };
  }

  private databaseStatus(exception: unknown): number | undefined {
    if (!exception || typeof exception !== 'object') {
      return undefined;
    }

    const sqlState = findSqlState(exception);
    if (sqlState && SQLSTATE_TO_STATUS[sqlState]) {
      return SQLSTATE_TO_STATUS[sqlState];
    }

    const code = (exception as { code?: unknown }).code;
    if (typeof code === 'string' && PRISMA_TO_STATUS[code]) {
      return PRISMA_TO_STATUS[code];
    }

    if ((exception as { name?: unknown }).name === 'PrismaClientValidationError') {
      return HttpStatus.BAD_REQUEST;
    }

    return undefined;
  }
}

/**
 * Finds a PostgreSQL SQLSTATE in a pg error, or in the metadata/cause chain
 * that Prisma driver adapters attach to raw query errors (P2010).
 */
function findSqlState(error: object, depth = 0): string | undefined {
  if (depth > 4) {
    return undefined;
  }

  const candidate = error as {
    code?: unknown;
    originalCode?: unknown;
    meta?: unknown;
    cause?: unknown;
    driverAdapterError?: unknown;
  };

  for (const value of [candidate.originalCode, candidate.code]) {
    if (typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value) && !value.startsWith('P')) {
      return value;
    }
  }

  for (const nested of [candidate.meta, candidate.cause, candidate.driverAdapterError]) {
    if (nested && typeof nested === 'object') {
      const found = findSqlState(nested, depth + 1);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
}
