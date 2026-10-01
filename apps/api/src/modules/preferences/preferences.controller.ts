import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrismaService } from '../../database/prisma.service.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';

/**
 * Preferences (UC11).
 *
 * BR29/BR30: language sets interface text and formatting only — it is not a
 * currency, and it never touches a stored value. The main currency belongs to
 * the account; changing the language leaves R$ as R$.
 */
const patchInput = z.object({
  language: z.enum(['pt-BR', 'en']).optional(),
  theme: z.enum(['system', 'light', 'dark']).optional(),
  mainCurrency: z.string().length(3).optional(),
});

@Controller('preferences')
@UseGuards(AuthGuard)
export class PreferencesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(@CurrentUser() userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { username: true, language: true, theme: true, mainCurrency: true },
    });
    return user;
  }

  @Patch()
  async update(@CurrentUser() userId: string, @Body(new ZodPipe(patchInput)) body: z.infer<typeof patchInput>) {
    const data: Record<string, string> = {};
    if (body.language) data.language = body.language;
    if (body.theme) data.theme = body.theme;
    if (body.mainCurrency) data.mainCurrency = body.mainCurrency;
    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: { language: true, theme: true, mainCurrency: true },
    });
  }
}
