import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaRlsService } from './prisma-rls.service';
import { PrismaIotService } from './prisma-iot.service';

@Global()
@Module({
  providers: [
    PrismaService,
    PrismaIotService,
    PrismaRlsService,
  ],

  exports: [
    PrismaService,
    PrismaIotService,
    PrismaRlsService,
  ],
})
export class PrismaModule {}