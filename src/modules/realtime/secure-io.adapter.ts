import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';

export class SecureIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: string[] | false,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: Partial<ServerOptions>): Server {
    return super.createIOServer(port, {
      ...options,
      // JWT remains mandatory for native clients without an Origin header.
      cors: { origin: this.origins, credentials: true },
      allowRequest: (request, callback) => {
        const origin = request.headers.origin;
        callback(
          null,
          origin === undefined ||
            (this.origins !== false && this.origins.includes(origin)),
        );
      },
    } satisfies Partial<ServerOptions>) as Server;
  }
}
