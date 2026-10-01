import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';

import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { AuthService } from './auth.service.js';

const credentials = z.object({
  username: z.string().trim().min(3).max(40),
  password: z.string().min(6, 'at least 6 characters'),
});

const recovery = z.object({
  username: z.string().trim().min(3).max(40),
  code: z.string().trim().min(1),
  newPassword: z.string().min(6, 'at least 6 characters'),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('sign-up')
  async signUp(@Body(new ZodPipe(credentials)) body: z.infer<typeof credentials>) {
    const { user, recoveryCodes, token } = await this.auth.signUp(body.username, body.password);
    // The codes are shown exactly once (UC01).
    return { userId: user.id, username: user.username, token, recoveryCodes };
  }

  @Post('sign-in')
  async signIn(@Body(new ZodPipe(credentials)) body: z.infer<typeof credentials>) {
    const { user, token } = await this.auth.signIn(body.username, body.password);
    return { userId: user.id, username: user.username, token };
  }

  @Post('recover')
  async recover(@Body(new ZodPipe(recovery)) body: z.infer<typeof recovery>) {
    const { user, token } = await this.auth.recover(body.username, body.code, body.newPassword);
    return { userId: user.id, username: user.username, token };
  }
}
