import { ArgumentsHost, BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';

import { GlobalExceptionFilter } from './global-exception.filter';

function httpHost() {
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn<void, [Record<string, unknown>]>() };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('GlobalExceptionFilter', () => {
  const filter = new GlobalExceptionFilter();

  beforeEach(() => {
    jest.spyOn((filter as unknown as { logger: { error: () => void } }).logger, 'error').mockImplementation(() => undefined);
  });

  it('keeps the status and body of an HttpException', () => {
    const { host, response } = httpHost();
    filter.catch(new BadRequestException(['name must be a string']), host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, message: ['name must be a string'] }),
    );
  });

  it('wraps a string HttpException response in the standard body', () => {
    const { body } = filter.toResponse(
      new (class extends NotFoundException {
        getResponse() {
          return 'missing';
        }
      })(),
    );
    expect(body).toEqual({ statusCode: 404, message: 'missing', error: 'Not Found' });
  });

  it.each([
    ['23505', HttpStatus.CONFLICT],
    ['23503', HttpStatus.CONFLICT],
    ['23514', HttpStatus.BAD_REQUEST],
    ['22P02', HttpStatus.BAD_REQUEST],
    ['42501', HttpStatus.FORBIDDEN],
  ])('maps PostgreSQL SQLSTATE %s to %i', (code, status) => {
    const { status: actual, body } = filter.toResponse(Object.assign(new Error('duplicate key in auth.user'), { code }));
    expect(actual).toBe(status);
    expect(JSON.stringify(body)).not.toContain('auth.user');
  });

  it('finds the SQLSTATE inside a Prisma driver adapter error', () => {
    const error = Object.assign(new Error('Raw query failed'), {
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '23505' } } },
    });
    expect(filter.toResponse(error).status).toBe(HttpStatus.CONFLICT);
  });

  it.each([
    ['P2002', HttpStatus.CONFLICT],
    ['P2025', HttpStatus.NOT_FOUND],
    ['P2000', HttpStatus.BAD_REQUEST],
  ])('maps Prisma code %s to %i', (code, status) => {
    expect(filter.toResponse(Object.assign(new Error('x'), { code })).status).toBe(status);
  });

  it('maps a Prisma validation error to 400', () => {
    const error = Object.assign(new Error('Invalid value'), { name: 'PrismaClientValidationError' });
    expect(filter.toResponse(error).status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('hides unexpected errors behind a generic 500 and logs them', () => {
    const { host, response } = httpHost();
    filter.catch(new TypeError('Cannot read properties of undefined (reading "id")'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    const body = response.json.mock.calls[0][0];
    expect(body.statusCode).toBe(500);
    expect(JSON.stringify(body)).not.toContain('Cannot read');
    expect(body).not.toHaveProperty('stack');
  });

  it('treats non-object throws as internal errors', () => {
    expect(filter.toResponse('boom').status).toBe(500);
    expect(filter.toResponse(undefined).status).toBe(500);
  });

  it('rethrows outside the HTTP context', () => {
    const host = { getType: () => 'ws' } as unknown as ArgumentsHost;
    expect(() => filter.catch(new Error('socket'), host)).toThrow('socket');
  });
});
