import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { createTransactionSchema, type CreateTransactionInput } from '@cc/domain/schemas';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { TransactionsService } from './transactions.service.js';

@Controller('transactions')
@UseGuards(AuthGuard)
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post()
  create(
    @CurrentUser() userId: string,
    @Body(new ZodPipe(createTransactionSchema)) body: CreateTransactionInput,
  ) {
    return this.transactions.create(userId, body);
  }

  @Get('options')
  options(@CurrentUser() userId: string) {
    return this.transactions.options(userId);
  }

  // Editing amounts or sources is a full replace, not a patch: the entries and
  // their settlements are re-checked as a unit by BR12's deferred trigger.
  @Put(':id')
  replace(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body(new ZodPipe(createTransactionSchema)) body: CreateTransactionInput,
  ) {
    return this.transactions.replace(userId, id, body);
  }

  // Placed after `options` so the literal route wins over this parameter.
  @Get(':id')
  findOne(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.transactions.findOne(userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body(new ZodPipe(z.object({ categoryId: z.string().uuid().nullable().optional(), description: z.string().nullable().optional(), occurredOn: z.string().date().optional() }))) body: { categoryId?: string | null; description?: string | null; occurredOn?: string },
  ) {
    return this.transactions.update(userId, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.transactions.remove(userId, id);
  }

  @Get()
  list(
    @CurrentUser() userId: string,
    @Query('period') period?: string,
    @Query('wallets') wallets?: string,
    @Query('account') account?: string,
    @Query('card') card?: string,
    @Query('category') category?: string,
    @Query('kind') kind?: string,
    @Query('occurrence') occurrence?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.transactions.list(userId, period, {
      ...(wallets && wallets !== 'all'
        ? { walletIds: wallets.split(',').filter(Boolean) }
        : {}),
      ...(account ? { accountId: account } : {}),
      ...(card ? { cardId: card } : {}),
      ...(category ? { categoryId: category } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(kind === 'INCOME' || kind === 'EXPENSE' || kind === 'TRANSFER' ? { kind } : {}),
      ...(occurrence === 'OCCASIONAL' || occurrence === 'RECURRING' || occurrence === 'INSTALLMENT'
        ? { occurrenceType: occurrence }
        : {}),
    });
  }
}
