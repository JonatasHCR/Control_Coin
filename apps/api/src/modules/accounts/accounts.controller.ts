import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { AccountsService } from './accounts.service.js';

const walletInput = z.object({ name: z.string().trim().min(1).max(60) });

const accountInput = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(['BANK', 'CASH', 'LIABILITY']), // BR39 — a debt, not money held
  currency: z.string().length(3).default('BRL'),
  initialBalance: z.string().regex(/^-?\d+\.\d{2}$/).default('0.00'),
  walletId: z.string().uuid().nullable().default(null),
});

/** BR09: at least one function, and credit terms only when credit is enabled. */
const cardInput = z
  .object({
    accountId: z.string().uuid(),
    name: z.string().trim().min(1).max(60),
    allowsCredit: z.boolean().default(false),
    allowsDebit: z.boolean().default(false),
    creditLimit: z.string().regex(/^\d+\.\d{2}$/).nullable().default(null),
    closingDay: z.number().int().min(1).max(31).nullable().default(null),
    dueDay: z.number().int().min(1).max(31).nullable().default(null),
  })
  .refine((c) => c.allowsCredit || c.allowsDebit, {
    message: 'BR09 — a card enables at least one function',
  })
  .refine((c) => !c.allowsCredit || (c.creditLimit && c.closingDay && c.dueDay), {
    message: 'BR09 — a credit card needs a limit, a closing day and a due day',
  });

const linkInput = z.object({
  kind: z.enum(['ACCOUNT', 'CARD']),
  parentId: z.string().uuid().nullable(),
});

@Controller('accounts')
@UseGuards(AuthGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  tree(@CurrentUser() userId: string) {
    return this.accounts.tree(userId);
  }

  @Get('archived')
  archived(@CurrentUser() userId: string) {
    return this.accounts.archived(userId);
  }

  @Post('wallets')
  createWallet(@CurrentUser() userId: string, @Body(new ZodPipe(walletInput)) body: z.infer<typeof walletInput>) {
    return this.accounts.createWallet(userId, body.name);
  }

  @Post()
  createAccount(@CurrentUser() userId: string, @Body(new ZodPipe(accountInput)) body: z.infer<typeof accountInput>) {
    return this.accounts.createAccount(userId, body);
  }

  @Post('cards')
  createCard(@CurrentUser() userId: string, @Body(new ZodPipe(cardInput)) body: z.infer<typeof cardInput>) {
    return this.accounts.createCard(userId, body);
  }
  @Patch('wallets/:id')
  updateWallet(@CurrentUser() u: string, @Param('id') id: string, @Body(new ZodPipe(z.object({ name: z.string().optional(), description: z.string().nullable().optional() }))) b: { name?: string; description?: string | null }) {
    return this.accounts.updateWallet(u, id, b);
  }

  @Patch('cards/:id')
  updateCard(@CurrentUser() u: string, @Param('id') id: string, @Body(new ZodPipe(z.object({ name: z.string().optional(), allowsCredit: z.boolean().optional(), allowsDebit: z.boolean().optional(), creditLimit: z.string().regex(/^\d+\.\d{2}$/).nullable().optional(), closingDay: z.number().int().min(1).max(31).nullable().optional(), dueDay: z.number().int().min(1).max(31).nullable().optional() }))) b: { name?: string; allowsCredit?: boolean; allowsDebit?: boolean; creditLimit?: string | null; closingDay?: number | null; dueDay?: number | null }) {
    return this.accounts.updateCard(u, id, b);
  }

  @Patch(':id')
  updateAccount(@CurrentUser() u: string, @Param('id') id: string, @Body(new ZodPipe(z.object({ name: z.string() }))) b: { name: string }) {
    return this.accounts.updateAccount(u, id, b);
  }

  @Post(':id/archive')
  archive(@CurrentUser() u: string, @Param('id') id: string, @Query('kind') kind: 'WALLET' | 'ACCOUNT' | 'CARD', @Query('undo') undo?: string) {
    return this.accounts.archive(u, kind, id, undo !== 'true');
  }

  @Delete(':id')
  remove(@CurrentUser() u: string, @Param('id') id: string, @Query('kind') kind: 'WALLET' | 'ACCOUNT' | 'CARD') {
    return this.accounts.remove(u, kind, id);
  }

  @Post(':id/link')
  link(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body(new ZodPipe(linkInput)) body: z.infer<typeof linkInput>,
  ) {
    return this.accounts.link(userId, body.kind, id, body.parentId);
  }
}
