import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { CategoriesService } from './categories.service.js';

const money = z.string().regex(/^\d+\.\d{2}$/);

const createInput = z.object({
  name: z.string().trim().min(1).max(60),
  parentId: z.string().uuid().nullable().default(null),
  isEssential: z.boolean().default(false),      // BR17 — nothing is essential by default
  monthlyTarget: money.nullable().default(null), // BR20 — null means "no expectation stated"
});

const patchInput = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  isEssential: z.boolean().optional(),
  monthlyTarget: money.nullable().optional(),
});

@Controller('categories')
@UseGuards(AuthGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.categories.list(userId);
  }

  @Post()
  create(@CurrentUser() userId: string, @Body(new ZodPipe(createInput)) body: z.infer<typeof createInput>) {
    return this.categories.create(userId, body);
  }
  @Delete(':id')
  remove(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Query('reassignTo') reassignTo?: string,
    @Query('deleteChildren') deleteChildren?: string,
  ) {
    return this.categories.remove(userId, id, { reassignTo: reassignTo ?? null, deleteChildren: deleteChildren === 'true' });
  }

  @Patch(':id')
  update(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body(new ZodPipe(patchInput)) body: z.infer<typeof patchInput>,
  ) {
    return this.categories.update(userId, id, body);
  }
}
