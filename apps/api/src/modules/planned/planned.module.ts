import { Module } from '@nestjs/common';

import { TransactionsModule } from '../transactions/transactions.module.js';
import { PlannedController } from './planned.controller.js';
import { PlannedService } from './planned.service.js';

@Module({
  imports: [TransactionsModule],
  controllers: [PlannedController],
  providers: [PlannedService],
})
export class PlannedModule {}
