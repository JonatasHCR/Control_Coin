import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

import { ERROR_CODES } from '@cc/domain/rules';

import { Clock } from '../../common/clock/clock.js';
import { DomainError, mapDatabaseError } from '../../common/errors/domain-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { generateRecoveryCodes, hashPassword, verifyPassword } from './password.js';

const SESSION_DAYS = 30;
const MAX_FAILED_ATTEMPTS = 5;      // UC01 alt flow
const LOCKOUT_WINDOW_MINUTES = 15;

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** UC01: username and password. No email, ever (BR28). */
  async signUp(username: string, password: string) {
    let user;
    try {
      user = await this.prisma.user.create({
        data: { username, passwordHash: await hashPassword(password) },
      });
    } catch (error) {
      // A taken username is an ordinary outcome, not a 500 — map it to the
      // stable DUPLICATE code the sign-up form shows as "username unavailable".
      const mapped = mapDatabaseError(error);
      if (mapped?.code === ERROR_CODES.DUPLICATE) {
        throw new DomainError(ERROR_CODES.DUPLICATE, 'username already taken');
      }
      throw error;
    }

    // Shown once. Only the hashes are kept.
    const codes = generateRecoveryCodes();
    await this.prisma.recoveryCode.createMany({
      data: codes.map((code) => ({ userId: user.id, codeHash: sha256(code) })),
    });

    return { user, recoveryCodes: codes, token: await this.startSession(user.id) };
  }

  async signIn(username: string, password: string) {
    if (await this.isLockedOut(username)) {
      throw new UnauthorizedException('temporarily locked');
    }

    const user = await this.prisma.user.findUnique({ where: { username } });
    const ok = user ? await verifyPassword(password, user.passwordHash) : false;

    await this.prisma.$executeRaw`
      INSERT INTO login_attempt (id, username, succeeded)
      VALUES (gen_random_uuid(), ${username}, ${ok})`;

    if (!user || !ok) throw new UnauthorizedException('invalid credentials');
    return { user, token: await this.startSession(user.id) };
  }

  /**
   * UC01 alt flow: recover access with a one-time recovery code — the only path
   * without email (BR28). The code is consumed and the password reset together,
   * and every existing session is revoked, so a leaked password cannot outlive
   * the reset. A wrong username and a wrong code give the same failure, so a
   * guess learns nothing about which was wrong.
   */
  async recover(username: string, code: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    const record = user
      ? await this.prisma.recoveryCode.findFirst({
          where: { userId: user.id, codeHash: sha256(code.trim()), usedAt: null },
        })
      : null;

    if (!user || !record) {
      throw new UnauthorizedException('invalid recovery code');
    }

    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.recoveryCode.update({ where: { id: record.id }, data: { usedAt: this.clock.now() } }),
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      this.prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: this.clock.now() },
      }),
    ]);

    return { user, token: await this.startSession(user.id) };
  }

  /** Resolves a bearer token to a user, or null. Used by the guard. */
  async resolveSession(token: string): Promise<string | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!session || session.revokedAt || session.expiresAt < this.clock.now()) return null;

    await this.prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: this.clock.now() },
    });
    return session.userId;
  }

  private async startSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.clock.now());
    expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);

    await this.prisma.session.create({
      data: { userId, tokenHash: sha256(token), expiresAt },
    });
    return token;
  }

  /** Counted per username, so attempts on unknown accounts are limited too. */
  private async isLockedOut(username: string): Promise<boolean> {
    const since = new Date(this.clock.now().getTime() - LOCKOUT_WINDOW_MINUTES * 60_000);
    const [row] = await this.prisma.$queryRaw<{ failures: bigint }[]>`
      SELECT count(*) AS failures FROM login_attempt
       WHERE username = ${username} AND succeeded = false AND attempted_at > ${since}`;
    return Number(row?.failures ?? 0) >= MAX_FAILED_ATTEMPTS;
  }
}
