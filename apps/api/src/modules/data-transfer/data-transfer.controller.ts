import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';

import { ERROR_CODES } from '@cc/domain/rules';

import { userError } from '../../common/errors/domain-error.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { BackupService } from './backup.service.js';
import { DataTransferService } from './data-transfer.service.js';
import { WorkbookService } from './workbook.service.js';
import { XlsxService } from './xlsx.service.js';

const importInput = z.object({
  accountId: z.string().uuid(),
  csv: z.string().min(1),
  columns: z.object({ date: z.number().int(), amount: z.number().int(), description: z.number().int() }),
});

@Controller('data')
@UseGuards(AuthGuard)
export class DataTransferController {
  constructor(
    private readonly data: DataTransferService,
    private readonly xlsx: XlsxService,
    private readonly backup: BackupService,
    private readonly workbook: WorkbookService,
  ) {}

  /** The fill-in workbook, pre-filled with the user's cadastros. */
  @Get('template.xlsx')
  async template(@CurrentUser() userId: string, @Res() res: Response): Promise<void> {
    const buffer = await this.workbook.template(userId);
    res
      .status(200)
      .setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('Content-Disposition', 'attachment; filename="control-coin-modelo.xlsx"')
      .send(buffer);
  }

  @Post('import-workbook')
  @UseInterceptors(FileInterceptor('file'))
  importWorkbook(@CurrentUser() userId: string, @UploadedFile() file: { buffer: Buffer } | undefined) {
    if (!file) throw userError(ERROR_CODES.VALIDATION_FAILED, 'envie o arquivo');
    return this.workbook.import(userId, file.buffer);
  }

  /** Full backup: every row the user owns, as JSON. */
  @Get('backup.json')
  async exportBackup(@CurrentUser() userId: string, @Res() res: Response): Promise<void> {
    const backup = await this.backup.export(userId);
    res
      .status(200)
      .setHeader('Content-Type', 'application/json; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="control-coin-backup-${backup.exportedAt.slice(0, 10)}.json"`)
      .send(JSON.stringify(backup));
  }

  @Post('restore')
  @UseInterceptors(FileInterceptor('file'))
  restore(
    @CurrentUser() userId: string,
    @Query('replace') replace: string | undefined,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ) {
    if (!file) throw userError(ERROR_CODES.VALIDATION_FAILED, 'envie o arquivo');
    return this.backup.restore(userId, file.buffer, replace === 'true');
  }

  /** BR25: CSV export at one level. */
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  exportCsv(@CurrentUser() userId: string, @Query('level') level?: string) {
    return this.data.exportCsv(userId, level === 'settlement' ? 'settlement' : 'transaction');
  }

  /** BR26: Excel export — one workbook, both levels, five sheets. */
  @Get('export.xlsx')
  async exportXlsx(@CurrentUser() userId: string, @Res() res: Response): Promise<void> {
    const buffer = await this.xlsx.export(userId);
    res
      .status(200)
      .setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('Content-Disposition', 'attachment; filename="control-coin.xlsx"')
      .send(buffer);
  }

  @Post('import')
  importCsv(@CurrentUser() userId: string, @Body(new ZodPipe(importInput)) body: z.infer<typeof importInput>) {
    return this.data.importCsv(userId, body.accountId, body.csv, body.columns);
  }

  /** BR26: Excel import — read safely, handle the four hazards. */
  @Post('import.xlsx')
  @UseInterceptors(FileInterceptor('file'))
  importXlsx(
    @CurrentUser() userId: string,
    @Query('accountId') accountId: string,
    @Query('sheet') sheet: string | undefined,
    @UploadedFile() file: { buffer: Buffer },
  ) {
    return this.xlsx.import(userId, accountId, file.buffer, sheet);
  }
}
