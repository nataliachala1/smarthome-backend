import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaRlsService {
  constructor(private readonly prisma: PrismaService) {}

  async withUserContext<T>(
    userId: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT set_config(
          'app.current_user_id',
          ${userId},
          true
        )
      `;

      return operation(tx);
    });
  }
}