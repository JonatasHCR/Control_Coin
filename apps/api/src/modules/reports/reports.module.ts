import { Module } from '@nestjs/common';

import { ReportsController } from './reports.controller.js';
import { ReportsRepository } from './reports.repository.js';
import { SummaryPdfService } from './summary-pdf.service.js';

@Module({
  controllers: [ReportsController],
  providers: [ReportsRepository, SummaryPdfService],
})
export class ReportsModule {}
