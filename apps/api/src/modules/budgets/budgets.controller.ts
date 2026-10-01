import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { BudgetsService } from './budgets.service.js';

const createInput = z.object({
  categoryId: z.string().uuid(),
  periodStart: z.string().date(),
  limitAmount: z.string().regex(/^\d+\.\d{2}$/).nullable().default(null), // BR23
  currency: z.string().length(3).default('BRL'),
});

@Controller('budgets')
@UseGuards(AuthGuard)
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get()
  list(@CurrentUser() userId: string, @Query('period') period?: string) {
    return this.budgets.list(userId, period ?? new Date().toISOString().slice(0, 7));
  }

  @Patch(':id')
  update(@CurrentUser() userId: string, @Param('id') id: string, @Body(new ZodPipe(z.object({ limitAmount: z.string().regex(/^\d+\.\d{2}$/).nullable() }))) body: { limitAmount: string | null }) {
    return this.budgets.update(userId, id, body.limitAmount);
  }

  @Delete(':id')
  remove(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.budgets.remove(userId, id);
  }

  @Post()
  create(@CurrentUser() userId: string, @Body(new ZodPipe(createInput)) body: z.infer<typeof createInput>) {
    return this.budgets.create(userId, body);
  }
}
