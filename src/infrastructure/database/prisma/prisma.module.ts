import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaRlsService } from './prisma-rls.service';

@Global()
@Module({
  providers: [PrismaService, PrismaRlsService],
  exports: [PrismaService, PrismaRlsService],
})
export class PrismaModule {}
