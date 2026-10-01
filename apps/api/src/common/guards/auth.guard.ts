import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import { AuthService } from '../../modules/auth/auth.service.js';

/**
 * Answers only "may this caller proceed". Ownership is enforced by row-level
 * security inside the query's transaction, never here — a guard touches a
 * different pooled connection than the query does (ARCH05).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { userId?: string }>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException();

    const userId = await this.auth.resolveSession(token);
    if (!userId) throw new UnauthorizedException();

    request.userId = userId;
    return true;
  }
}
