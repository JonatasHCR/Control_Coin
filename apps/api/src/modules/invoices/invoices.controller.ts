import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { InvoicesService } from './invoices.service.js';

/** BR31: paid from accounts only — debt cannot pay debt. */
const payInput = z.object({
  paidOn: z.string().date(),
  sources: z
    .array(
      z.object({
        accountId: z.string().uuid(),
        amount: z.string().regex(/^\d+\.\d{2}$/),
      }),
    )
    .min(1),
});

@Controller('invoices')
@UseGuards(AuthGuard)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.invoices.list(userId);
  }

  @Post(':id/pay')
  pay(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body(new ZodPipe(payInput)) body: z.infer<typeof payInput>,
  ) {
    return this.invoices.pay(userId, id, body);
  }
}
