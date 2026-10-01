import { Global, Module } from '@nestjs/common';

import { Clock, SystemClock } from '../common/clock/clock.js';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService, { provide: Clock, useClass: SystemClock }],
  exports: [PrismaService, Clock],
})
export class DatabaseModule {}
