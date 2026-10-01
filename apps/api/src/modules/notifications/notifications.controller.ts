import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Clock } from '../../common/clock/clock.js';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
  ) {}

  @Get()
  async list(@CurrentUser() userId: string) {
    // Evaluate on read so the centre is current without waiting for the job.
    await this.notifications.evaluate(userId, this.clock.today());
    const [items, unread] = await Promise.all([
      this.notifications.list(userId),
      this.notifications.unreadCount(userId),
    ]);
    return { items, unread };
  }
  @Get('rules')
  listRules(@CurrentUser() u: string) {
    return this.notifications.listRules(u);
  }

  @Post('rules')
  createRule(@CurrentUser() u: string, @Body(new ZodPipe(z.object({ type: z.string(), targetType: z.string().nullable().optional(), targetId: z.string().uuid().nullable().optional(), thresholdPercent: z.number().int().nullable().optional(), daysBefore: z.number().int().nullable().optional() }))) b: { type: string; targetType?: string | null; targetId?: string | null; thresholdPercent?: number | null; daysBefore?: number | null }) {
    return this.notifications.createRule(u, b);
  }

  @Patch('rules/:id')
  updateRule(@CurrentUser() u: string, @Param('id') id: string, @Body(new ZodPipe(z.object({ thresholdPercent: z.number().int().nullable().optional(), daysBefore: z.number().int().nullable().optional(), active: z.boolean().optional() }))) b: { thresholdPercent?: number | null; daysBefore?: number | null; active?: boolean }) {
    return this.notifications.updateRule(u, id, b);
  }

  @Delete('rules/:id')
  removeRule(@CurrentUser() u: string, @Param('id') id: string) {
    return this.notifications.removeRule(u, id);
  }

  @Post('read')
  markAllRead(@CurrentUser() userId: string) {
    return this.notifications.markAllRead(userId);
  }

  @Post(':id/read')
  markRead(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.notifications.markRead(userId, id);
  }

  @Delete(':id')
  dismiss(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.notifications.dismiss(userId, id);
  }
}
