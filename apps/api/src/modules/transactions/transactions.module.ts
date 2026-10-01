import { Module } from '@nestjs/common';

import { Clock } from '../../common/clock/clock.js';
import { PrismaService } from '../../database/prisma.service.js';
import { TransactionsController } from './transactions.controller.js';
import { TransactionsService } from './transactions.service.js';

@Module({
  controllers: [TransactionsController],
  providers: [
    {
      provide: TransactionsService,
      useFactory: (prisma: PrismaService, clock: Clock) =>
        new TransactionsService(prisma, clock),
      inject: [PrismaService, Clock],
    },
  ],
  exports: [TransactionsService],
})
export class TransactionsModule {}
