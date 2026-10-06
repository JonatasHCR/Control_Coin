import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { PlannedService } from './planned.service.js';

const money = z.string().regex(/^\d+\.\d{2}$/).refine((v) => Number(v) > 0, 'valor deve ser maior que zero');
const id = z.string().uuid().nullable().default(null);

const plannedInput = z.object({
  kind: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']),
  description: z.string().trim().min(1).max(200),
  categoryId: id,
  amount: money,
  expectedOn: z.string().date(),
  accountId: id,
  cardId: id,
  cardFunction: z.enum(['CREDIT', 'DEBIT']).nullable().default(null),
  destinationAccountId: id,
  notifyDaysBefore: z.number().int().min(0).max(60).default(3),
});

const confirmInput = z.object({
  occurredOn: z.string().date(),
  amount: money,
  description: z.string().trim().max(200).optional(),
  categoryId: id,
  accountId: id,
  cardId: id,
  cardFunction: z.enum(['CREDIT', 'DEBIT']).nullable().default(null),
  installmentCount: z.number().int().min(1).max(120).default(1),
  destinationAccountId: id,
});

/** UC13 — planned transactions (BR40). */
@Controller('planned')
@UseGuards(AuthGuard)
export class PlannedController {
  constructor(private readonly planned: PlannedService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.planned.list(userId);
  }

  @Post()
  create(@CurrentUser() userId: string, @Body(new ZodPipe(plannedInput)) body: z.infer<typeof plannedInput>) {
    return this.planned.create(userId, body);
  }

  @Patch(':id')
  update(@CurrentUser() userId: string, @Param('id') id: string, @Body(new ZodPipe(plannedInput)) body: z.infer<typeof plannedInput>) {
    return this.planned.update(userId, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.planned.remove(userId, id);
  }

  @Post(':id/confirm')
  confirm(@CurrentUser() userId: string, @Param('id') id: string, @Body(new ZodPipe(confirmInput)) body: z.infer<typeof confirmInput>) {
    return this.planned.confirm(userId, id, body);
  }

  @Post(':id/postpone')
  postpone(@CurrentUser() userId: string, @Param('id') id: string, @Body(new ZodPipe(z.object({ expectedOn: z.string().date() }))) body: { expectedOn: string }) {
    return this.planned.postpone(userId, id, body.expectedOn);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.planned.cancel(userId, id);
  }
}
