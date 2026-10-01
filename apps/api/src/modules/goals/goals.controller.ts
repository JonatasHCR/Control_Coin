import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { GoalsService } from './goals.service.js';

const money = z.string().regex(/^\d+\.\d{2}$/);

// BR15: exactly one source, never a card. The shape is refined per source.
const createInput = z.object({
  name: z.string().trim().min(1).max(60),
  targetAmount: money,
  deadline: z.string().date(),
  sourceType: z.enum(['WALLET', 'ACCOUNT', 'MANUAL']),
  walletId: z.string().uuid().nullable().default(null),
  accountId: z.string().uuid().nullable().default(null),
});

const contributeInput = z.object({ amount: money, on: z.string().date() });

@Controller('goals')
@UseGuards(AuthGuard)
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.goals.list(userId);
  }

  @Post()
  create(@CurrentUser() userId: string, @Body(new ZodPipe(createInput)) body: z.infer<typeof createInput>) {
    return this.goals.create(userId, body);
  }

  @Patch(':id')
  update(@CurrentUser() userId: string, @Param('id') id: string, @Body(new ZodPipe(z.object({ name: z.string().optional(), targetAmount: money.optional(), deadline: z.string().date().optional(), status: z.string().optional() }))) body: { name?: string; targetAmount?: string; deadline?: string; status?: string }) {
    return this.goals.update(userId, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.goals.remove(userId, id);
  }

  @Post(':id/contributions')
  contribute(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body(new ZodPipe(contributeInput)) body: z.infer<typeof contributeInput>,
  ) {
    return this.goals.contribute(userId, id, body.amount, body.on);
  }
}
