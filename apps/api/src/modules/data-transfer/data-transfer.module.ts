import { Module } from '@nestjs/common';

import { TransactionsModule } from '../transactions/transactions.module.js';
import { BackupService } from './backup.service.js';
import { DataTransferController } from './data-transfer.controller.js';
import { DataTransferService } from './data-transfer.service.js';
import { WorkbookService } from './workbook.service.js';
import { XlsxService } from './xlsx.service.js';

@Module({
  imports: [TransactionsModule],
  controllers: [DataTransferController],
  providers: [DataTransferService, XlsxService, BackupService, WorkbookService],
})
export class DataTransferModule {}
